package taskwarrior

import (
	"encoding/json"
	"testing"
	"time"
)

// A trimmed but realistic slice of `task export` output, including a
// user-defined attribute, a completed task without a working id, and a
// recurrence field that must not surface as a UDA.
const exportFixture = `[
  {"id":19,"description":"Flaschenvertrag fertigstellen","due":"20260823T215959Z",
   "entry":"20260820T200007Z","modified":"20260824T094830Z","pom":1,"priority":"H",
   "status":"pending","uuid":"46df3135-ff84-496a-891c-b1bf79991a67","tags":["privat"],
   "urgency":24.4096},
  {"id":4,"description":"PROD-1140","due":"20260820T220000Z","entry":"20260820T185526Z",
   "start":"20260821T170114Z","modified":"20260821T170114Z","priority":"H",
   "status":"pending","uuid":"3618ff3a-a4d9-4336-b413-08faf4a2e708","tags":["beruflich"],
   "urgency":21.781},
  {"id":0,"description":"Ordnungssystem entwickeln","end":"20260822T130438Z",
   "entry":"20260821T170733Z","modified":"20260822T130438Z","priority":"H",
   "status":"completed","uuid":"1cb582cd-218c-4d2a-8be7-87e45cb66a33","tags":[],
   "estimate":"PT2H","urgency":13.7452,
   "annotations":[{"entry":"20260822T120000Z","description":"scanner ready"}]},
  {"id":30,"description":"Wochenrueckblick","entry":"20260801T090000Z",
   "modified":"20260801T090000Z","status":"recurring","recur":"weekly","rtype":"periodic",
   "mask":"++","uuid":"7f0b6a41-1d0e-4c33-9a1f-2b6c5d0e9a12","urgency":3.2,
   "depends":["46df3135-ff84-496a-891c-b1bf79991a67"]}
]`

func parseFixture(t *testing.T) []Task {
	t.Helper()
	tasks, err := parseTasks([]byte(exportFixture))
	if err != nil {
		t.Fatalf("parseTasks: %v", err)
	}
	if len(tasks) != 4 {
		t.Fatalf("got %d tasks, want 4", len(tasks))
	}
	return tasks
}

func byUUID(tasks []Task, uuid string) *Task {
	for i := range tasks {
		if tasks[i].UUID == uuid {
			return &tasks[i]
		}
	}
	return nil
}

func TestParseTasksConvertsDatesToRFC3339(t *testing.T) {
	tasks := parseFixture(t)
	task := byUUID(tasks, "46df3135-ff84-496a-891c-b1bf79991a67")
	if task == nil {
		t.Fatal("task missing")
	}
	if task.Due != "2026-08-23T21:59:59Z" {
		t.Errorf("Due = %q, want 2026-08-23T21:59:59Z", task.Due)
	}
	if task.Entry != "2026-08-20T20:00:07Z" {
		t.Errorf("Entry = %q", task.Entry)
	}
	// The converted value must be what the browser's Date can parse.
	if _, err := time.Parse(time.RFC3339, task.Due); err != nil {
		t.Errorf("Due is not RFC 3339: %v", err)
	}
}

func TestParseTaskDateLeavesUnknownFormatsIntact(t *testing.T) {
	if got := parseTaskDate("not-a-date"); got != "not-a-date" {
		t.Errorf("parseTaskDate = %q, want the input passed through", got)
	}
	if got := parseTaskDate(""); got != "" {
		t.Errorf("parseTaskDate(\"\") = %q, want empty", got)
	}
}

func TestParseTasksCapturesUDAsAndSkipsBookkeeping(t *testing.T) {
	tasks := parseFixture(t)

	numeric := byUUID(tasks, "46df3135-ff84-496a-891c-b1bf79991a67")
	if got := numeric.UDAs["pom"]; got != "1" {
		t.Errorf("pom = %q, want \"1\" without a decimal tail", got)
	}

	duration := byUUID(tasks, "1cb582cd-218c-4d2a-8be7-87e45cb66a33")
	if got := duration.UDAs["estimate"]; got != "PT2H" {
		t.Errorf("estimate = %q, want PT2H", got)
	}

	// rtype, mask and parent are recurrence bookkeeping, not user attributes.
	recurring := byUUID(tasks, "7f0b6a41-1d0e-4c33-9a1f-2b6c5d0e9a12")
	if len(recurring.UDAs) != 0 {
		t.Errorf("UDAs = %v, want none", recurring.UDAs)
	}
	if recurring.Recur != "weekly" {
		t.Errorf("Recur = %q, want weekly", recurring.Recur)
	}
	if len(recurring.Depends) != 1 {
		t.Errorf("Depends = %v, want one entry", recurring.Depends)
	}
}

func TestParseTasksReadsAnnotations(t *testing.T) {
	tasks := parseFixture(t)
	task := byUUID(tasks, "1cb582cd-218c-4d2a-8be7-87e45cb66a33")
	if len(task.Annotations) != 1 {
		t.Fatalf("Annotations = %v, want one", task.Annotations)
	}
	if task.Annotations[0].Entry != "2026-08-22T12:00:00Z" {
		t.Errorf("annotation entry = %q, want a converted date", task.Annotations[0].Entry)
	}
}

// Completed tasks export as id 0, so the UI must not use the id as identity.
func TestCompletedTasksHaveNoWorkingID(t *testing.T) {
	tasks := parseFixture(t)
	task := byUUID(tasks, "1cb582cd-218c-4d2a-8be7-87e45cb66a33")
	if task.ID != 0 {
		t.Errorf("ID = %d, want 0", task.ID)
	}
	if task.UUID == "" {
		t.Error("UUID must always be present")
	}
}

func TestSortTasksByUrgencyDescending(t *testing.T) {
	tasks := parseFixture(t)
	sortTasks(tasks)
	var urgencies []float64
	for _, task := range tasks {
		urgencies = append(urgencies, task.Urgency)
	}
	for i := 1; i < len(urgencies); i++ {
		if urgencies[i-1] < urgencies[i] {
			t.Fatalf("not sorted descending: %v", urgencies)
		}
	}
}

func TestSortTasksIsStableForEqualUrgency(t *testing.T) {
	tasks := []Task{{UUID: "b", Urgency: 5}, {UUID: "a", Urgency: 5}}
	sortTasks(tasks)
	if tasks[0].UUID != "a" {
		t.Errorf("ties should break on uuid, got %s first", tasks[0].UUID)
	}
}

func TestCountTasks(t *testing.T) {
	tasks := parseFixture(t)
	// Between the fixture's two due dates, so exactly one is overdue.
	now := time.Date(2026, 8, 22, 0, 0, 0, 0, time.UTC)
	counts := countTasks(tasks, now)

	if counts.Total != 4 || counts.Pending != 2 || counts.Completed != 1 || counts.Recurring != 1 {
		t.Errorf("counts = %+v", counts)
	}
	if counts.Active != 1 {
		t.Errorf("Active = %d, want 1", counts.Active)
	}
	if counts.Overdue != 1 {
		t.Errorf("Overdue = %d, want 1", counts.Overdue)
	}
}

// A completed task with a due date in the past is finished, not overdue.
func TestCountTasksIgnoresOverdueOnFinishedTasks(t *testing.T) {
	tasks := []Task{{Status: "completed", Due: "2020-01-01T00:00:00Z"}}
	if got := countTasks(tasks, time.Now()).Overdue; got != 0 {
		t.Errorf("Overdue = %d, want 0", got)
	}
}

func TestParseStatusFilter(t *testing.T) {
	cases := map[string]StatusFilter{
		"":          StatusPending,
		"pending":   StatusPending,
		"completed": StatusCompleted,
		"all":       StatusAll,
	}
	for input, want := range cases {
		got, err := ParseStatusFilter(input)
		if err != nil || got != want {
			t.Errorf("ParseStatusFilter(%q) = (%q, %v), want %q", input, got, err, want)
		}
	}

	// Anything else is rejected before it can reach the command line.
	for _, input := range []string{"deleted", "pending; rm -rf /", "rc.data.location=/tmp"} {
		if _, err := ParseStatusFilter(input); err == nil {
			t.Errorf("ParseStatusFilter(%q) should fail", input)
		}
	}
}

func TestStatusFilterArgs(t *testing.T) {
	if got := StatusPending.args(); len(got) != 1 || got[0] != "status:pending" {
		t.Errorf("pending args = %v", got)
	}
	if got := StatusAll.args(); len(got) != 0 {
		t.Errorf("all args = %v, want none", got)
	}
}

func TestDecodeScalar(t *testing.T) {
	cases := map[string]string{
		`"PT2H"`:    "PT2H",
		`3`:         "3",
		`3.5`:       "3.5",
		`true`:      "true",
		`null`:      "",
		`["a","b"]`: `["a","b"]`,
	}
	for input, want := range cases {
		if got := decodeScalar(json.RawMessage(input)); got != want {
			t.Errorf("decodeScalar(%s) = %q, want %q", input, got, want)
		}
	}
}

// A single malformed field must not take the whole list down.
func TestDecodeTaskToleratesWrongTypes(t *testing.T) {
	tasks, err := parseTasks([]byte(`[{"uuid":"x","description":"ok","urgency":"not-a-number","tags":"privat"}]`))
	if err != nil {
		t.Fatalf("parseTasks: %v", err)
	}
	if tasks[0].Description != "ok" {
		t.Errorf("Description = %q", tasks[0].Description)
	}
	if tasks[0].Urgency != 0 {
		t.Errorf("Urgency = %v, want 0", tasks[0].Urgency)
	}
	// A comma-separated string is how older versions exported lists.
	if len(tasks[0].Tags) != 1 || tasks[0].Tags[0] != "privat" {
		t.Errorf("Tags = %v", tasks[0].Tags)
	}
}

func TestUDALabels(t *testing.T) {
	config := &Config{Settings: []Setting{
		{Key: "uda.pom.label", Value: "Pomodoris"},
		{Key: "uda.pom.type", Value: "numeric"},
		{Key: "uda.empty.label", Value: ""},
		{Key: "report.list.labels", Value: "ID,Description"},
	}}
	labels := udaLabels(config)
	if labels["pom"] != "Pomodoris" {
		t.Errorf("pom label = %q", labels["pom"])
	}
	if _, ok := labels["empty"]; ok {
		t.Error("an empty label should be omitted")
	}
	if len(labels) != 1 {
		t.Errorf("labels = %v, want only pom", labels)
	}
}
