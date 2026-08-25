package taskwarrior

import (
	"context"
	"os"
	"strings"
	"sync"
	"time"
)

// Service reads the Taskwarrior configuration and caches the result.
//
// The cache is invalidated when the rc file's modification time changes,
// which covers the common case of the user editing ~/.taskrc while the
// server runs. Edits to included files are not detected; the settings view
// is read-only, so a stale include is a cosmetic staleness at worst.
type Service struct {
	mu        sync.Mutex
	cached    *Config
	cachedAt  time.Time
	rcModTime time.Time
}

// NewService returns a Service with an empty cache.
func NewService() *Service {
	return &Service{}
}

// Config returns the effective Taskwarrior configuration, reading it from
// the `task` binary on the first call and whenever the rc file changed.
func (s *Service) Config(ctx context.Context) (*Config, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	rcPath, err := taskrcPath()
	if err != nil {
		return nil, err
	}

	var modTime time.Time
	if info, statErr := os.Stat(rcPath); statErr == nil {
		modTime = info.ModTime()
	}

	if s.cached != nil && modTime.Equal(s.rcModTime) {
		return s.cached, nil
	}

	config, err := load(ctx, rcPath)
	if err != nil {
		return nil, err
	}

	s.cached = config
	s.cachedAt = time.Now()
	s.rcModTime = modTime
	return config, nil
}

// load reads the configuration without consulting the cache.
func load(ctx context.Context, rcPath string) (*Config, error) {
	showOutput, err := runTask(ctx, "_show")
	if err != nil {
		return nil, err
	}

	effective, err := parseShow(strings.NewReader(showOutput))
	if err != nil {
		return nil, err
	}

	version := ""
	if out, err := runTask(ctx, "--version"); err == nil {
		version = parseVersion(out)
	}

	// A missing or unreadable rc file is not fatal: every value is then
	// simply reported as a Taskwarrior default.
	origins, unresolved, err := parseTaskrc(rcPath, themeDirs())
	if err != nil {
		origins = nil
		unresolved = nil
	}

	// Only `task show` knows which keys Taskwarrior recognises, and it
	// reports them in a footnote. rc.verbose is forced so the footnote does
	// not depend on the user's own verbosity setting.
	var unrecognized []string
	if out, err := runTask(ctx, "rc.verbose=footnote", "show"); err == nil {
		unrecognized = parseUnrecognized(out)
	}

	return build(effective, origins, rcPath, version, unresolved, unrecognized), nil
}

// Tasks returns the tasks matching the given status filter.
//
// Unlike the configuration, tasks change while the server runs, so this is
// read fresh on every request; `task export` on a normal task list is fast
// enough that caching would trade correctness for nothing.
func (s *Service) Tasks(ctx context.Context, filter StatusFilter) (*TaskList, error) {
	// rc.verbose=nothing keeps informational banners such as the release
	// note out of stdout, which would otherwise not be valid JSON.
	args := append([]string{"rc.verbose=nothing"}, filter.args()...)
	args = append(args, "export")

	output, err := runTask(ctx, args...)
	if err != nil {
		return nil, err
	}

	tasks, err := parseTasks([]byte(output))
	if err != nil {
		return nil, err
	}

	// The configuration supplies both the sort order and the UDA labels. It
	// is cached separately, and neither is worth failing the request over:
	// without it the list still renders, in the default order.
	config, configErr := s.Config(ctx)

	spec := sortSpecFor(nil)
	if configErr == nil {
		spec = sortSpecFor(config)
	}
	keys, unsupported := parseSortSpec(spec)
	sortTasksBy(tasks, keys)

	list := &TaskList{
		Status: filter,
		Counts: countTasks(tasks, time.Now()),
		Tasks:  tasks,
		Sort: SortSpec{
			Report:      sortReport,
			Spec:        spec,
			Unsupported: unsupported,
		},
	}
	if configErr == nil {
		list.UDALabels = udaLabels(config)
	}

	return list, nil
}

// udaLabels extracts `uda.<name>.label` entries from the configuration.
func udaLabels(config *Config) map[string]string {
	labels := make(map[string]string)
	for _, setting := range config.Settings {
		name, ok := strings.CutPrefix(setting.Key, "uda.")
		if !ok {
			continue
		}
		name, ok = strings.CutSuffix(name, ".label")
		if !ok || name == "" || setting.Value == "" {
			continue
		}
		labels[name] = setting.Value
	}
	if len(labels) == 0 {
		return nil
	}
	return labels
}
