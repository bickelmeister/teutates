package taskwarrior

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"
)

// taskDateLayout is Taskwarrior's export format: ISO 8601 basic, always UTC.
// It is not what time.RFC3339 parses, so every date field is converted before
// it reaches the browser.
const taskDateLayout = "20060102T150405Z"

// StatusFilter selects which tasks to export.
type StatusFilter string

const (
	StatusPending   StatusFilter = "pending"
	StatusCompleted StatusFilter = "completed"
	StatusAll       StatusFilter = "all"
)

// ParseStatusFilter validates a filter coming from a query parameter.
// Only known values are accepted; the value is never passed through to the
// `task` command line as free text.
func ParseStatusFilter(raw string) (StatusFilter, error) {
	switch StatusFilter(strings.TrimSpace(raw)) {
	case "", StatusPending:
		return StatusPending, nil
	case StatusCompleted:
		return StatusCompleted, nil
	case StatusAll:
		return StatusAll, nil
	default:
		return "", fmt.Errorf("taskwarrior: unknown status filter %q", raw)
	}
}

// args returns the fixed command-line filter for this selection.
func (f StatusFilter) args() []string {
	switch f {
	case StatusCompleted:
		return []string{"status:completed"}
	case StatusAll:
		return nil
	default:
		return []string{"status:pending"}
	}
}

// Annotation is a timestamped note attached to a task.
type Annotation struct {
	Entry       string `json:"entry"`
	Description string `json:"description"`
}

// Task is a single task as presented to the UI.
type Task struct {
	// ID is Taskwarrior's short working id. It is only assigned to pending
	// tasks; completed tasks export as 0, so UUID is the stable identity.
	ID          int          `json:"id"`
	UUID        string       `json:"uuid"`
	Description string       `json:"description"`
	Status      string       `json:"status"`
	Project     string       `json:"project,omitempty"`
	Tags        []string     `json:"tags,omitempty"`
	Priority    string       `json:"priority,omitempty"`
	Urgency     float64      `json:"urgency"`
	Due         string       `json:"due,omitempty"`
	Scheduled   string       `json:"scheduled,omitempty"`
	Wait        string       `json:"wait,omitempty"`
	Entry       string       `json:"entry,omitempty"`
	Start       string       `json:"start,omitempty"`
	End         string       `json:"end,omitempty"`
	Modified    string       `json:"modified,omitempty"`
	Recur       string       `json:"recur,omitempty"`
	Depends     []string     `json:"depends,omitempty"`
	Annotations []Annotation `json:"annotations,omitempty"`
	// UDAs holds user-defined attributes, which differ per installation and
	// would be silently dropped by a fixed schema.
	UDAs map[string]string `json:"udas,omitempty"`
}

// TaskList is the payload served by the tasks endpoint.
type TaskList struct {
	Status StatusFilter `json:"status"`
	Counts Counts       `json:"counts"`
	Tasks  []Task       `json:"tasks"`
	// UDALabels maps a UDA name to its configured human-readable label.
	UDALabels map[string]string `json:"udaLabels,omitempty"`
}

// Counts summarises the returned set by status.
type Counts struct {
	Total     int `json:"total"`
	Pending   int `json:"pending"`
	Completed int `json:"completed"`
	Waiting   int `json:"waiting"`
	Recurring int `json:"recurring"`
	Deleted   int `json:"deleted"`
	Active    int `json:"active"`
	Overdue   int `json:"overdue"`
}

// knownFields are the attributes mapped onto Task. Anything else that
// Taskwarrior exports is treated as a user-defined attribute.
var knownFields = map[string]bool{
	"id": true, "uuid": true, "description": true, "status": true,
	"project": true, "tags": true, "priority": true, "urgency": true,
	"due": true, "scheduled": true, "wait": true, "entry": true,
	"start": true, "end": true, "modified": true, "recur": true,
	"depends": true, "annotations": true,
	// Recurrence bookkeeping that is meaningless in a task list.
	"rtype": true, "mask": true, "imask": true, "parent": true,
}

// parseTaskDate converts a Taskwarrior timestamp to RFC 3339 so the browser
// can parse it. Unparseable values are passed through unchanged rather than
// discarded, so a surprising format stays visible instead of vanishing.
func parseTaskDate(raw string) string {
	if raw == "" {
		return ""
	}
	parsed, err := time.Parse(taskDateLayout, raw)
	if err != nil {
		return raw
	}
	return parsed.UTC().Format(time.RFC3339)
}

// parseTasks decodes `task export` output.
func parseTasks(data []byte) ([]Task, error) {
	var raw []map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, fmt.Errorf("taskwarrior: decoding task export: %w", err)
	}

	tasks := make([]Task, 0, len(raw))
	for _, entry := range raw {
		tasks = append(tasks, decodeTask(entry))
	}
	return tasks, nil
}

func decodeTask(entry map[string]json.RawMessage) Task {
	task := Task{
		ID:          decodeInt(entry["id"]),
		UUID:        decodeString(entry["uuid"]),
		Description: decodeString(entry["description"]),
		Status:      decodeString(entry["status"]),
		Project:     decodeString(entry["project"]),
		Tags:        decodeStrings(entry["tags"]),
		Priority:    decodeString(entry["priority"]),
		Urgency:     decodeFloat(entry["urgency"]),
		Due:         parseTaskDate(decodeString(entry["due"])),
		Scheduled:   parseTaskDate(decodeString(entry["scheduled"])),
		Wait:        parseTaskDate(decodeString(entry["wait"])),
		Entry:       parseTaskDate(decodeString(entry["entry"])),
		Start:       parseTaskDate(decodeString(entry["start"])),
		End:         parseTaskDate(decodeString(entry["end"])),
		Modified:    parseTaskDate(decodeString(entry["modified"])),
		Recur:       decodeString(entry["recur"]),
		Depends:     decodeStrings(entry["depends"]),
		Annotations: decodeAnnotations(entry["annotations"]),
	}

	for name, value := range entry {
		if knownFields[name] {
			continue
		}
		if task.UDAs == nil {
			task.UDAs = make(map[string]string)
		}
		task.UDAs[name] = decodeScalar(value)
	}

	return task
}

func decodeAnnotations(raw json.RawMessage) []Annotation {
	if len(raw) == 0 {
		return nil
	}
	var annotations []Annotation
	if err := json.Unmarshal(raw, &annotations); err != nil {
		return nil
	}
	for i := range annotations {
		annotations[i].Entry = parseTaskDate(annotations[i].Entry)
	}
	return annotations
}

func countTasks(tasks []Task, now time.Time) Counts {
	var counts Counts
	counts.Total = len(tasks)
	for _, task := range tasks {
		switch task.Status {
		case "pending":
			counts.Pending++
		case "completed":
			counts.Completed++
		case "waiting":
			counts.Waiting++
		case "recurring":
			counts.Recurring++
		case "deleted":
			counts.Deleted++
		}
		if task.Start != "" {
			counts.Active++
		}
		// A completed task with a past due date is not overdue any more.
		if task.Status == "pending" && task.Due != "" {
			if due, err := time.Parse(time.RFC3339, task.Due); err == nil && due.Before(now) {
				counts.Overdue++
			}
		}
	}
	return counts
}

// sortTasks orders by urgency, matching what `task list` shows first. UUID
// breaks ties so the order is stable across requests.
func sortTasks(tasks []Task) {
	sort.SliceStable(tasks, func(i, j int) bool {
		if tasks[i].Urgency != tasks[j].Urgency {
			return tasks[i].Urgency > tasks[j].Urgency
		}
		return tasks[i].UUID < tasks[j].UUID
	})
}
