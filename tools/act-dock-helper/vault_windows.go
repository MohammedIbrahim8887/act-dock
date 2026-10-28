//go:build windows

package main

import (
	"encoding/json"
	"fmt"
	"golang.org/x/sys/windows"
	"os"
	"unsafe"
)

var advapi = windows.NewLazySystemDLL("advapi32.dll")
var credRead = advapi.NewProc("CredReadW")
var credWrite = advapi.NewProc("CredWriteW")
var credDelete = advapi.NewProc("CredDeleteW")
var credFree = advapi.NewProc("CredFree")

type credential struct {
	Flags          uint32
	Type           uint32
	TargetName     *uint16
	Comment        *uint16
	LastWritten    windows.Filetime
	BlobSize       uint32
	Blob           *byte
	Persist        uint32
	AttributeCount uint32
	Attributes     uintptr
	TargetAlias    *uint16
	UserName       *uint16
}

func key(id string) *uint16 { p, _ := windows.UTF16PtrFromString("ActDock/" + id); return p }
func writeCredential(id string, value []byte) error {
	c := credential{Type: 1, TargetName: key(id), Persist: 2, BlobSize: uint32(len(value))}
	if len(value) > 0 {
		c.Blob = &value[0]
	}
	r, _, _ := credWrite.Call(uintptr(unsafe.Pointer(&c)), 0)
	if r == 0 {
		return fail("VAULT_UNAVAILABLE")
	}
	return nil
}
func readCredential(id string) ([]byte, error) {
	var ptr *credential
	r, _, e := credRead.Call(uintptr(unsafe.Pointer(key(id))), 1, 0, uintptr(unsafe.Pointer(&ptr)))
	if r == 0 {
		if e == windows.ERROR_NOT_FOUND {
			return nil, fail("SECRET_NOT_FOUND")
		}
		return nil, fail("VAULT_UNAVAILABLE")
	}
	defer credFree.Call(uintptr(unsafe.Pointer(ptr)))
	return append([]byte(nil), unsafe.Slice(ptr.Blob, ptr.BlobSize)...), nil
}
func deleteCredential(id string) error {
	r, _, err := credDelete.Call(uintptr(unsafe.Pointer(key(id))), 1, 0)
	if r == 0 && err != windows.ERROR_NOT_FOUND {
		return fail("VAULT_UNAVAILABLE")
	}
	return nil
}
func vaultStatus() error {
	_, err := readCredential("status-probe")
	if err != nil && err.Error() == "SECRET_NOT_FOUND" {
		return nil
	}
	return err
}
func vaultPut(id, value string) error {
	data := []byte(value)
	chunks := (len(data) + 3999) / 4000
	for i := 0; i < chunks; i++ {
		end := (i + 1) * 4000
		if end > len(data) {
			end = len(data)
		}
		if err := writeCredential(fmt.Sprintf("%s/chunk-%d", id, i), data[i*4000:end]); err != nil {
			for previous := 0; previous < i; previous++ {
				_ = deleteCredential(fmt.Sprintf("%s/chunk-%d", id, previous))
			}
			return err
		}
	}
	meta, _ := json.Marshal(chunks)
	if err := writeCredential(id, meta); err != nil {
		for i := 0; i < chunks; i++ {
			_ = deleteCredential(fmt.Sprintf("%s/chunk-%d", id, i))
		}
		return err
	}
	return nil
}
func vaultGet(id string) (string, error) {
	meta, err := readCredential(id)
	if err != nil {
		return "", err
	}
	var n int
	if json.Unmarshal(meta, &n) != nil || n < 0 || n > 13 {
		return "", fail("VAULT_UNAVAILABLE")
	}
	var value []byte
	for i := 0; i < n; i++ {
		chunk, err := readCredential(fmt.Sprintf("%s/chunk-%d", id, i))
		if err != nil {
			return "", err
		}
		value = append(value, chunk...)
	}
	return string(value), nil
}
func vaultDelete(id string) error {
	meta, err := readCredential(id)
	if err != nil {
		if err.Error() == "SECRET_NOT_FOUND" {
			return nil
		}
		return err
	}
	var n int
	if json.Unmarshal(meta, &n) != nil || n < 0 || n > 13 {
		return fail("VAULT_UNAVAILABLE")
	}
	for i := 0; i < n; i++ {
		if err := deleteCredential(fmt.Sprintf("%s/chunk-%d", id, i)); err != nil {
			return err
		}
	}
	return deleteCredential(id)
}
func privateFile(path string, data []byte) error {
	token, err := windows.OpenCurrentProcessToken()
	if err != nil {
		return err
	}
	defer token.Close()
	user, err := token.GetTokenUser()
	if err != nil {
		return err
	}
	sd, err := windows.SecurityDescriptorFromString("D:P(A;;FA;;;SY)(A;;FA;;;" + user.User.Sid.String() + ")")
	if err != nil {
		return err
	}
	p, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return err
	}
	h, err := windows.CreateFile(p, windows.GENERIC_WRITE, 0, &windows.SecurityAttributes{Length: uint32(unsafe.Sizeof(windows.SecurityAttributes{})), SecurityDescriptor: sd}, windows.CREATE_NEW, windows.FILE_ATTRIBUTE_NORMAL, 0)
	if err != nil {
		return err
	}
	f := os.NewFile(uintptr(h), path)
	defer f.Close()
	if _, err = f.Write(data); err != nil {
		return err
	}
	return f.Sync()
}
