package handlers

import (
	"errors"
	"fmt"
	"net/http"
	"testing"

	"github.com/bickelmeister/teutates/backend/taskwarrior"
)

func TestClassify(t *testing.T) {
	cases := []struct {
		name     string
		err      error
		status   int
		wantHint bool
	}{
		{
			name:     "missing binary is a service problem the user can fix",
			err:      fmt.Errorf("loading config: %w", taskwarrior.ErrTaskNotFound),
			status:   http.StatusServiceUnavailable,
			wantHint: true,
		},
		{
			name:     "a hung task invocation is a gateway timeout",
			err:      errors.New("taskwarrior: `task _show` timed out after 3s"),
			status:   http.StatusGatewayTimeout,
			wantHint: true,
		},
		{
			name:   "anything else is an internal error",
			err:    errors.New("taskwarrior: reading /home/user/.taskrc: permission denied"),
			status: http.StatusInternalServerError,
		},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			status, body := classify(c.err)
			if status != c.status {
				t.Errorf("status = %d, want %d", status, c.status)
			}
			if body.Error != c.err.Error() {
				t.Errorf("error = %q, want %q", body.Error, c.err.Error())
			}
			if (body.Hint != "") != c.wantHint {
				t.Errorf("hint = %q, wantHint = %v", body.Hint, c.wantHint)
			}
		})
	}
}
