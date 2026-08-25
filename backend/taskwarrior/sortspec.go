package taskwarrior

import (
	"sort"
	"strings"
)

// defaultSortSpec is used when the configuration carries no sort order for
// the report, matching Taskwarrior's `next` report.
const defaultSortSpec = "urgency-"

// sortReport is the report whose sort order the task list follows. `list` is
// the report `task list` uses, so the UI and the command line agree.
const sortReport = "list"

// SortSpec describes the ordering applied to a task list.
type SortSpec struct {
	// Report names the Taskwarrior report the order was taken from.
	Report string `json:"report"`
	// Spec is the raw configuration value, e.g. "start-,due+,project+,urgency-".
	Spec string `json:"spec"`
	// Unsupported lists attributes teutates cannot sort by; they are skipped
	// rather than silently changing the order.
	Unsupported []string `json:"unsupported,omitempty"`
}

// sortKey is one clause of a sort specification.
type sortKey struct {
	attribute  string
	descending bool
}

// attributeKind determines how missing values are treated.
type attributeKind int

const (
	// kindDate covers timestamps. Taskwarrior sorts tasks without the date
	// last in both directions, so an undated task never leads the list.
	kindDate attributeKind = iota
	// kindText compares lexicographically, which puts an empty value first
	// ascending and last descending — how `project+` behaves.
	kindText
	// kindNumber treats a missing value as zero.
	kindNumber
	// kindPriority is an ordered enum where "no priority" ranks below L.
	kindPriority
)

// sortableAttributes maps the attribute names a sort spec may use onto the
// task field they read. Anything absent here is reported as unsupported.
var sortableAttributes = map[string]struct {
	kind attributeKind
	text func(Task) string
	num  func(Task) float64
}{
	"due":         {kind: kindDate, text: func(t Task) string { return t.Due }},
	"start":       {kind: kindDate, text: func(t Task) string { return t.Start }},
	"end":         {kind: kindDate, text: func(t Task) string { return t.End }},
	"entry":       {kind: kindDate, text: func(t Task) string { return t.Entry }},
	"modified":    {kind: kindDate, text: func(t Task) string { return t.Modified }},
	"scheduled":   {kind: kindDate, text: func(t Task) string { return t.Scheduled }},
	"wait":        {kind: kindDate, text: func(t Task) string { return t.Wait }},
	"project":     {kind: kindText, text: func(t Task) string { return t.Project }},
	"description": {kind: kindText, text: func(t Task) string { return t.Description }},
	"status":      {kind: kindText, text: func(t Task) string { return t.Status }},
	"uuid":        {kind: kindText, text: func(t Task) string { return t.UUID }},
	"urgency":     {kind: kindNumber, num: func(t Task) float64 { return t.Urgency }},
	"id":          {kind: kindNumber, num: func(t Task) float64 { return float64(t.ID) }},
	"priority":    {kind: kindPriority, text: func(t Task) string { return t.Priority }},
}

// priorityRank orders priorities. A task without a priority ranks lowest, so
// `priority-` lists H, M, L and then the unprioritised ones.
var priorityRank = map[string]int{"L": 1, "M": 2, "H": 3}

// parseSortSpec reads a Taskwarrior sort specification such as
// "start-,due+,project+,urgency-". A trailing "/" marks a visual break in
// Taskwarrior's reports and has no effect on the order, so it is stripped.
func parseSortSpec(spec string) ([]sortKey, []string) {
	var keys []sortKey
	var unsupported []string

	for _, clause := range strings.Split(spec, ",") {
		clause = strings.TrimSpace(clause)
		clause = strings.TrimSuffix(clause, "/")
		if clause == "" {
			continue
		}

		descending := false
		switch clause[len(clause)-1] {
		case '-':
			descending = true
			clause = clause[:len(clause)-1]
		case '+':
			clause = clause[:len(clause)-1]
		}
		if clause == "" {
			continue
		}

		if _, ok := sortableAttributes[clause]; !ok {
			unsupported = append(unsupported, clause)
			continue
		}
		keys = append(keys, sortKey{attribute: clause, descending: descending})
	}

	return keys, unsupported
}

// compareBy returns -1, 0 or 1 for a single sort clause.
func compareBy(a, b Task, key sortKey) int {
	attribute := sortableAttributes[key.attribute]

	var result int
	switch attribute.kind {
	case kindDate:
		left, right := attribute.text(a), attribute.text(b)
		// A missing date sorts last whichever way the clause points, so the
		// comparison is returned before the direction is applied.
		switch {
		case left == "" && right == "":
			return 0
		case left == "":
			return 1
		case right == "":
			return -1
		}
		// Dates are RFC 3339 in UTC and therefore fixed width, which makes
		// lexicographic order the same as chronological order.
		result = strings.Compare(left, right)

	case kindPriority:
		left, right := priorityRank[attribute.text(a)], priorityRank[attribute.text(b)]
		switch {
		case left < right:
			result = -1
		case left > right:
			result = 1
		}

	case kindNumber:
		left, right := attribute.num(a), attribute.num(b)
		switch {
		case left < right:
			result = -1
		case left > right:
			result = 1
		}

	default:
		result = strings.Compare(attribute.text(a), attribute.text(b))
	}

	if key.descending {
		return -result
	}
	return result
}

// sortTasksBy orders tasks by the given clauses. Ties fall back to the
// working id and then the uuid, so the order is stable across requests even
// for completed tasks, which all export an id of 0.
func sortTasksBy(tasks []Task, keys []sortKey) {
	sort.SliceStable(tasks, func(i, j int) bool {
		for _, key := range keys {
			if result := compareBy(tasks[i], tasks[j], key); result != 0 {
				return result < 0
			}
		}
		if tasks[i].ID != tasks[j].ID {
			return tasks[i].ID < tasks[j].ID
		}
		return tasks[i].UUID < tasks[j].UUID
	})
}

// sortSpecFor reads the sort order configured for the report teutates
// follows, falling back to the default when it is not configured.
func sortSpecFor(config *Config) string {
	if config == nil {
		return defaultSortSpec
	}
	key := "report." + sortReport + ".sort"
	for _, setting := range config.Settings {
		if setting.Key == key && setting.Value != "" {
			return setting.Value
		}
	}
	return defaultSortSpec
}
