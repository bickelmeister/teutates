package taskwarrior

import (
	"reflect"
	"testing"
)

func TestParseSortSpec(t *testing.T) {
	keys, unsupported := parseSortSpec("start-,due+,project+,urgency-")
	want := []sortKey{
		{attribute: "start", descending: true},
		{attribute: "due"},
		{attribute: "project"},
		{attribute: "urgency", descending: true},
	}
	if !reflect.DeepEqual(keys, want) {
		t.Errorf("keys = %+v, want %+v", keys, want)
	}
	if len(unsupported) != 0 {
		t.Errorf("unsupported = %v, want none", unsupported)
	}
}

// A trailing "/" marks a visual break in Taskwarrior's reports and must not
// be read as part of the attribute name.
func TestParseSortSpecStripsBreakMarker(t *testing.T) {
	keys, unsupported := parseSortSpec("project+/,description+")
	if len(keys) != 2 || keys[0].attribute != "project" || keys[0].descending {
		t.Fatalf("keys = %+v", keys)
	}
	if len(unsupported) != 0 {
		t.Errorf("unsupported = %v, want none", unsupported)
	}
}

// An attribute teutates cannot sort by is reported instead of silently
// changing the order.
func TestParseSortSpecReportsUnsupportedAttributes(t *testing.T) {
	keys, unsupported := parseSortSpec("due+,depends-,urgency-")
	if len(keys) != 2 {
		t.Errorf("keys = %+v, want the two supported clauses", keys)
	}
	if !reflect.DeepEqual(unsupported, []string{"depends"}) {
		t.Errorf("unsupported = %v, want [depends]", unsupported)
	}
}

func TestParseSortSpecIgnoresEmptyClauses(t *testing.T) {
	keys, _ := parseSortSpec(" , due+ ,, ")
	if len(keys) != 1 || keys[0].attribute != "due" {
		t.Errorf("keys = %+v, want a single due clause", keys)
	}
}

// A clause without an explicit direction is ascending.
func TestParseSortSpecDefaultsToAscending(t *testing.T) {
	keys, _ := parseSortSpec("project")
	if len(keys) != 1 || keys[0].descending {
		t.Errorf("keys = %+v, want ascending", keys)
	}
}

// Taskwarrior sorts tasks without the date last whichever way the clause
// points, so an undated task never leads the list.
func TestMissingDatesSortLastInBothDirections(t *testing.T) {
	for _, spec := range []string{"due+", "due-"} {
		tasks := []Task{
			{ID: 1},
			{ID: 2, Due: "2026-08-23T00:00:00Z"},
			{ID: 3, Due: "2026-08-20T00:00:00Z"},
		}
		keys, _ := parseSortSpec(spec)
		sortTasksBy(tasks, keys)
		if tasks[2].ID != 1 {
			t.Errorf("%s: undated task ended at position %d, want last", spec, indexOf(tasks, 1))
		}
	}
}

// Text is different: an empty project sorts first ascending, which is how
// `project+` behaves in Taskwarrior.
func TestMissingTextSortsNaturally(t *testing.T) {
	tasks := []Task{
		{ID: 1, Project: "diaro"},
		{ID: 2},
		{ID: 3, Project: "portio"},
	}
	keys, _ := parseSortSpec("project+")
	sortTasksBy(tasks, keys)
	if tasks[0].ID != 2 {
		t.Errorf("order = %v, want the project-less task first", ids(tasks))
	}

	keys, _ = parseSortSpec("project-")
	sortTasksBy(tasks, keys)
	if tasks[2].ID != 2 {
		t.Errorf("order = %v, want the project-less task last", ids(tasks))
	}
}

// A task without a priority ranks below L.
func TestPriorityOrdering(t *testing.T) {
	tasks := []Task{{ID: 1, Priority: "L"}, {ID: 2}, {ID: 3, Priority: "H"}, {ID: 4, Priority: "M"}}
	keys, _ := parseSortSpec("priority-")
	sortTasksBy(tasks, keys)
	if got := ids(tasks); !reflect.DeepEqual(got, []int{3, 4, 1, 2}) {
		t.Errorf("order = %v, want [3 4 1 2]", got)
	}
}

// Completed tasks all export an id of 0, so the uuid has to break the tie
// for the order to be stable across requests.
func TestTiesBreakOnIDThenUUID(t *testing.T) {
	tasks := []Task{
		{ID: 0, UUID: "b", Urgency: 5},
		{ID: 0, UUID: "a", Urgency: 5},
		{ID: 7, UUID: "z", Urgency: 5},
	}
	keys, _ := parseSortSpec("urgency-")
	sortTasksBy(tasks, keys)
	if tasks[0].UUID != "a" || tasks[1].UUID != "b" || tasks[2].UUID != "z" {
		t.Errorf("order = %v", uuids(tasks))
	}
}

func TestSortSpecForReadsTheListReport(t *testing.T) {
	config := &Config{Settings: []Setting{
		{Key: "report.next.sort", Value: "urgency-"},
		{Key: "report.list.sort", Value: "start-,due+,project+,urgency-"},
	}}
	if got := sortSpecFor(config); got != "start-,due+,project+,urgency-" {
		t.Errorf("sortSpecFor = %q", got)
	}
}

// The bare `sort` key is not a Taskwarrior setting; it must not be picked up
// in place of the report's order.
func TestSortSpecForIgnoresTheBareSortKey(t *testing.T) {
	config := &Config{Settings: []Setting{
		{Key: "sort", Value: "priority-,due+"},
	}}
	if got := sortSpecFor(config); got != defaultSortSpec {
		t.Errorf("sortSpecFor = %q, want the default %q", got, defaultSortSpec)
	}
}

func TestSortSpecForFallsBackWithoutConfig(t *testing.T) {
	if got := sortSpecFor(nil); got != defaultSortSpec {
		t.Errorf("sortSpecFor(nil) = %q, want %q", got, defaultSortSpec)
	}
}

// The order teutates produces must match what `task list` prints. Anything
// else means the UI and the command line disagree about the same data.
func TestSortMatchesRealTaskListOutput(t *testing.T) {
	tasks := []Task{
		// Captured from a real Taskwarrior 3.5.0 installation together with
		// the output of `task list`, so the expected order below is ground
		// truth rather than a restatement of the implementation.
		{ID: 1, UUID: "057205d5", Due: "2027-07-30T22:00:00Z", Urgency: 7.22192},
		{ID: 2, UUID: "dcde27a7", Due: "2026-08-31T21:59:59Z", Project: "fincheck.ios", Urgency: 9.58289},
		{ID: 3, UUID: "52a93642", Project: "portio", Urgency: 5.72192},
		{ID: 4, UUID: "3618ff3a", Start: "2026-08-21T17:01:14Z", Due: "2026-08-20T22:00:00Z", Urgency: 21.8115},
		{ID: 5, UUID: "160b8dce", Due: "2026-08-31T21:59:59Z", Project: "fincheck.ios", Urgency: 9.58289},
		{ID: 6, UUID: "7c8f4b91", Due: "2026-08-31T21:59:59Z", Project: "fincheck.ios", Urgency: 11.6829},
		{ID: 7, UUID: "95c9e7c1", Due: "2026-08-31T21:59:59Z", Project: "jobrad.devex.kavator", Urgency: 11.6829},
		{ID: 8, UUID: "90700966", Due: "2026-08-31T21:59:59Z", Project: "jobrad.devex.kavator", Urgency: 13.7829},
		{ID: 9, UUID: "f609f15d", Due: "2026-08-31T21:59:59Z", Project: "jobrad.devex.kavator", Urgency: 11.6829},
		{ID: 10, UUID: "85d4f703", Due: "2026-09-10T22:00:00Z", Project: "jobrad.devex.kavator", Urgency: 8.12192},
		{ID: 11, UUID: "1acfe336", Due: "2026-09-03T22:00:00Z", Project: "jobrad.devex.kavator", Urgency: 10.3115},
		{ID: 12, UUID: "13f32377", Due: "2026-09-03T22:00:00Z", Project: "jobrad.devex.kavator", Urgency: 10.3115},
		{ID: 14, UUID: "e75d8cfc", Due: "2026-08-31T21:59:59Z", Project: "jobrad", Urgency: 13.7829},
		{ID: 15, UUID: "64a334fd", Project: "diaro", Urgency: 5.72192},
		{ID: 16, UUID: "8596aee3", Project: "diaro.ios", Urgency: 5.72192},
		{ID: 17, UUID: "7b5e2df3", Project: "diaro.ios", Urgency: 5.72192},
		{ID: 18, UUID: "b9ad9769", Due: "2026-08-30T21:59:59Z", Urgency: 8.24003},
		{ID: 19, UUID: "46df3135", Due: "2026-08-23T21:59:59Z", Urgency: 24.44},
		{ID: 20, UUID: "ae03da31", Due: "2026-08-31T21:59:59Z", Urgency: 12.7829},
		{ID: 21, UUID: "a30df783", Start: "2026-08-22T13:04:53Z", Due: "2026-08-23T21:59:59Z", Project: "digitaleablage", Urgency: 19.3346},
		{ID: 22, UUID: "070ae6e4", Due: "2026-08-31T21:59:59Z", Project: "digitaleablage", Urgency: 11.6774},
		{ID: 23, UUID: "39e43dd5", Due: "2026-08-31T21:59:59Z", Project: "digitaleablage", Urgency: 11.6774},
		{ID: 24, UUID: "cc649b1a", Due: "2026-08-31T21:59:59Z", Project: "digitaleablage", Urgency: 11.6774},
		{ID: 25, UUID: "3e4886e1", Due: "2026-09-04T19:29:25Z", Project: "digitaleablage", Urgency: 9.89664},
		{ID: 26, UUID: "d4ddaf61", Due: "2026-09-04T19:29:36Z", Project: "digitaleablage", Urgency: 9.89658},
		{ID: 27, UUID: "ccce8c2e", Due: "2026-09-04T19:29:52Z", Project: "digitaleablage", Urgency: 9.8965},
		{ID: 28, UUID: "5313a9b5", Due: "2026-08-23T22:00:00Z", Urgency: 16.4291},
		{ID: 29, UUID: "7183a448", Urgency: 2.60548},
	}

	keys, unsupported := parseSortSpec("start-,due+,project+,urgency-")
	if len(unsupported) != 0 {
		t.Fatalf("unsupported = %v", unsupported)
	}
	sortTasksBy(tasks, keys)

	want := []int{21, 4, 19, 28, 18, 20, 22, 23, 24, 6, 2, 5, 14, 8, 7, 9, 11, 12, 25, 26, 27, 10, 1, 29, 15, 16, 17, 3}
	if got := ids(tasks); !reflect.DeepEqual(got, want) {
		t.Errorf("order mismatch\n got: %v\nwant: %v", got, want)
	}
}

func ids(tasks []Task) []int {
	result := make([]int, 0, len(tasks))
	for _, task := range tasks {
		result = append(result, task.ID)
	}
	return result
}

func uuids(tasks []Task) []string {
	result := make([]string, 0, len(tasks))
	for _, task := range tasks {
		result = append(result, task.UUID)
	}
	return result
}

func indexOf(tasks []Task, id int) int {
	for i, task := range tasks {
		if task.ID == id {
			return i
		}
	}
	return -1
}
