package main

import (
	"encoding/json"
	"errors"
	"github.com/joho/godotenv"
	"io"
	"os"
	"path/filepath"
)

type Request struct {
	PID    int    `json:"pid"`
	Op     string `json:"op"`
	ID     string `json:"id"`
	Value  string `json:"value"`
	URL    string `json:"url"`
	Ref    string `json:"ref"`
	Token  string `json:"token"`
	Path   string `json:"path"`
	Source string `json:"source"`
	Alias  string `json:"alias"`
}
type Reply struct {
	OK    bool   `json:"ok"`
	Value any    `json:"value,omitempty"`
	Code  string `json:"code,omitempty"`
}

func main() {
	var r Request
	decoder := json.NewDecoder(io.LimitReader(os.Stdin, 8*1024*1024+1))
	if err := decoder.Decode(&r); err != nil {
		json.NewEncoder(os.Stdout).Encode(Reply{Code: "INVALID_REQUEST"})
		return
	}
	value, err := handle(r)
	reply := Reply{OK: err == nil, Value: value}
	if err != nil {
		reply.Value = nil
		reply.Code = "HELPER_ERROR"
		var typed *failure
		if errors.As(err, &typed) {
			reply.Code = typed.code
		}
	}
	json.NewEncoder(os.Stdout).Encode(reply)
}

type failure struct{ code string }

func (e *failure) Error() string { return e.code }
func fail(code string) error     { return &failure{code} }
func handle(r Request) (any, error) {
	switch r.Op {
	case "process_identity":
		if r.PID <= 0 {
			return nil, fail("INVALID_PID")
		}
		return processIdentity(r.PID)
	case "parse_dotenv":
		values, err := godotenv.Unmarshal(r.Value)
		if err != nil {
			return nil, fail("INVALID_DOTENV")
		}
		return values, nil
	case "action_fetch":
		return fetchAction(r)
	case "image_alias":
		return nil, rewriteImage(r)
	case "private_file":
		if !filepath.IsAbs(r.Path) {
			return nil, fail("INVALID_PATH")
		}
		return nil, privateFile(r.Path, []byte(r.Value))
	case "vault_status":
		return nil, vaultStatus()
	case "vault_get":
		if !validID(r.ID) {
			return nil, fail("INVALID_SECRET_ID")
		}
		return vaultGet(r.ID)
	case "vault_put":
		if !validID(r.ID) || len(r.Value) > 49152 {
			return nil, fail("INVALID_SECRET")
		}
		return nil, vaultPut(r.ID, r.Value)
	case "vault_delete":
		if !validID(r.ID) {
			return nil, fail("INVALID_SECRET_ID")
		}
		return nil, vaultDelete(r.ID)
	}
	return nil, fail("UNKNOWN_OPERATION")
}
func validID(id string) bool {
	if len(id) < 1 || len(id) > 200 {
		return false
	}
	for _, r := range id {
		if !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '-' || r == '/' || r == '_') {
			return false
		}
	}
	return true
}
