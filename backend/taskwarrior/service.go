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

	return build(effective, origins, rcPath, version, unresolved), nil
}
