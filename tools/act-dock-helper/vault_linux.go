//go:build linux

package main

import (
	"fmt"
	dbus "github.com/godbus/dbus/v5"
)

const service = "org.freedesktop.Secret.Service"
const collection = "org.freedesktop.Secret.Collection"
const item = "org.freedesktop.Secret.Item"

type secret struct {
	Session     dbus.ObjectPath
	Parameters  []byte
	Value       []byte
	ContentType string
}

func connection() (*dbus.Conn, dbus.ObjectPath, error) {
	c, err := dbus.ConnectSessionBus()
	if err != nil {
		return nil, "", fail("VAULT_UNAVAILABLE")
	}
	var path dbus.ObjectPath
	if c.Object("org.freedesktop.secrets", "/org/freedesktop/secrets").Call(service+".ReadAlias", 0, "default").Store(&path) != nil || path == "/" {
		c.Close()
		return nil, "", fail("VAULT_UNAVAILABLE")
	}
	v, err := c.Object("org.freedesktop.secrets", path).GetProperty(collection + ".Locked")
	if err != nil {
		c.Close()
		return nil, "", fail("VAULT_UNAVAILABLE")
	}
	if locked, _ := v.Value().(bool); locked {
		c.Close()
		return nil, "", fail("VAULT_LOCKED")
	}
	return c, path, nil
}
func vaultStatus() error {
	c, _, err := connection()
	if c != nil {
		c.Close()
	}
	return err
}
func lookup(c *dbus.Conn, id string) (dbus.ObjectPath, error) {
	var unlocked, locked []dbus.ObjectPath
	err := c.Object("org.freedesktop.secrets", "/org/freedesktop/secrets").Call(service+".SearchItems", 0, map[string]string{"service": "dev.actdock.secrets", "account": id}).Store(&unlocked, &locked)
	if err != nil {
		return "", fail("VAULT_UNAVAILABLE")
	}
	if len(unlocked) > 0 {
		return unlocked[0], nil
	}
	if len(locked) > 0 {
		return "", fail("VAULT_LOCKED")
	}
	return "", fail("SECRET_NOT_FOUND")
}
func session(c *dbus.Conn) (dbus.ObjectPath, error) {
	var out dbus.Variant
	var path dbus.ObjectPath
	err := c.Object("org.freedesktop.secrets", "/org/freedesktop/secrets").Call(service+".OpenSession", 0, "plain", dbus.MakeVariant("")).Store(&out, &path)
	return path, err
}
func vaultGet(id string) (string, error) {
	c, _, err := connection()
	if err != nil {
		return "", err
	}
	defer c.Close()
	path, err := lookup(c, id)
	if err != nil {
		return "", err
	}
	s, err := session(c)
	if err != nil {
		return "", fail("VAULT_UNAVAILABLE")
	}
	defer c.Object("org.freedesktop.secrets", s).Call("org.freedesktop.Secret.Session.Close", 0)
	var value secret
	if c.Object("org.freedesktop.secrets", path).Call(item+".GetSecret", 0, s).Store(&value) != nil {
		return "", fail("VAULT_UNAVAILABLE")
	}
	return string(value.Value), nil
}
func vaultPut(id, value string) error {
	c, col, err := connection()
	if err != nil {
		return err
	}
	defer c.Close()
	s, err := session(c)
	if err != nil {
		return fail("VAULT_UNAVAILABLE")
	}
	defer c.Object("org.freedesktop.secrets", s).Call("org.freedesktop.Secret.Session.Close", 0)
	properties := map[string]dbus.Variant{item + ".Label": dbus.MakeVariant("Act Dock secret"), item + ".Attributes": dbus.MakeVariant(map[string]string{"service": "dev.actdock.secrets", "account": id})}
	var path, prompt dbus.ObjectPath
	err = c.Object("org.freedesktop.secrets", col).Call(collection+".CreateItem", 0, properties, secret{s, []byte{}, []byte(value), "text/plain; charset=utf-8"}, true).Store(&path, &prompt)
	if err != nil {
		return fail("VAULT_UNAVAILABLE")
	}
	if prompt != "/" {
		return fail("VAULT_LOCKED")
	}
	return nil
}
func vaultDelete(id string) error {
	c, _, err := connection()
	if err != nil {
		return err
	}
	defer c.Close()
	path, err := lookup(c, id)
	if err != nil {
		if err.Error() == "SECRET_NOT_FOUND" {
			return nil
		}
		return err
	}
	var prompt dbus.ObjectPath
	if c.Object("org.freedesktop.secrets", path).Call(item+".Delete", 0).Store(&prompt) != nil {
		return fail("VAULT_UNAVAILABLE")
	}
	if prompt != "/" {
		return fmt.Errorf("%w", fail("VAULT_LOCKED"))
	}
	return nil
}
