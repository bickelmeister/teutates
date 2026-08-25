package taskwarrior

import (
	"reflect"
	"testing"
)

// The exact shape of the footnote `task show` prints, blank lines included.
const showFootnote = `weekstart                          sunday
xterm.title                        0

Some of your .taskrc variables differ from the default values.
Your .taskrc file contains these unrecognized variables:
  sort
  colour.due

`

func TestParseUnrecognized(t *testing.T) {
	got := parseUnrecognized(showFootnote)
	if want := []string{"sort", "colour.due"}; !reflect.DeepEqual(got, want) {
		t.Errorf("parseUnrecognized = %v, want %v", got, want)
	}
}

// A configuration without mistakes prints no footnote at all.
func TestParseUnrecognizedWithoutFootnote(t *testing.T) {
	if got := parseUnrecognized("weekstart  sunday\nxterm.title  0\n"); got != nil {
		t.Errorf("parseUnrecognized = %v, want nil", got)
	}
}

// The block ends at the first blank line; whatever follows is not a key.
func TestParseUnrecognizedStopsAtTheBlockEnd(t *testing.T) {
	input := "Your .taskrc file contains these unrecognized variables:\n  sort\n\nSomething else entirely\n"
	if got := parseUnrecognized(input); !reflect.DeepEqual(got, []string{"sort"}) {
		t.Errorf("parseUnrecognized = %v, want [sort]", got)
	}
}

// An unindented line ends the block too, in case the trailing newline is gone.
func TestParseUnrecognizedStopsAtUnindentedLine(t *testing.T) {
	input := "Your .taskrc file contains these unrecognized variables:\n  sort\nNot a key\n"
	if got := parseUnrecognized(input); !reflect.DeepEqual(got, []string{"sort"}) {
		t.Errorf("parseUnrecognized = %v, want [sort]", got)
	}
}
