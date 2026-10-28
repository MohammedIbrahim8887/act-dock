//go:build !windows

package main

func processIdentity(pid int) (any, error) { return nil, fail("UNSUPPORTED_PLATFORM") }
