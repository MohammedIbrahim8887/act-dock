//go:build windows

package main

import (
	"fmt"
	"golang.org/x/sys/windows"
)

func processIdentity(pid int) (any, error) {
	handle, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, uint32(pid))
	if err == windows.ERROR_INVALID_PARAMETER {
		return map[string]any{"alive": false}, nil
	}
	if err != nil {
		return nil, fail("PROCESS_UNAVAILABLE")
	}
	defer windows.CloseHandle(handle)
	var code uint32
	if windows.GetExitCodeProcess(handle, &code) != nil {
		return nil, fail("PROCESS_UNAVAILABLE")
	}
	if code != 259 {
		return map[string]any{"alive": false}, nil
	}
	var created, exited, kernel, user windows.Filetime
	if windows.GetProcessTimes(handle, &created, &exited, &kernel, &user) != nil {
		return nil, fail("PROCESS_UNAVAILABLE")
	}
	return map[string]any{"alive": true, "birth": fmt.Sprintf("%08x%08x", created.HighDateTime, created.LowDateTime)}, nil
}
