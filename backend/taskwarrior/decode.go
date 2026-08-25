package taskwarrior

import (
	"encoding/json"
	"strconv"
	"strings"
)

// The decode helpers are deliberately forgiving: a task with one unexpected
// field type should still be listed, with that field empty, rather than
// failing the whole request.

func decodeString(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var value string
	if err := json.Unmarshal(raw, &value); err != nil {
		return ""
	}
	return value
}

func decodeInt(raw json.RawMessage) int {
	if len(raw) == 0 {
		return 0
	}
	var value int
	if err := json.Unmarshal(raw, &value); err != nil {
		return 0
	}
	return value
}

func decodeFloat(raw json.RawMessage) float64 {
	if len(raw) == 0 {
		return 0
	}
	var value float64
	if err := json.Unmarshal(raw, &value); err != nil {
		return 0
	}
	return value
}

func decodeStrings(raw json.RawMessage) []string {
	if len(raw) == 0 {
		return nil
	}
	var values []string
	if err := json.Unmarshal(raw, &values); err != nil {
		// Older Taskwarrior versions export dependencies as a comma-separated
		// string rather than a list.
		if single := decodeString(raw); single != "" {
			return strings.Split(single, ",")
		}
		return nil
	}
	if len(values) == 0 {
		return nil
	}
	return values
}

// decodeScalar renders a user-defined attribute of unknown type as text.
func decodeScalar(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}

	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		return strings.TrimSpace(string(raw))
	}

	switch typed := value.(type) {
	case string:
		return typed
	case bool:
		return strconv.FormatBool(typed)
	case float64:
		// UDAs of type numeric are frequently whole numbers; 3 reads better
		// than 3.000000.
		return strconv.FormatFloat(typed, 'f', -1, 64)
	case nil:
		return ""
	default:
		// Arrays and objects have no sensible flat rendering; keep the JSON.
		encoded, err := json.Marshal(typed)
		if err != nil {
			return ""
		}
		return string(encoded)
	}
}
