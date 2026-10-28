//go:build darwin

package main

/*
#cgo LDFLAGS: -framework CoreFoundation -framework Security
#include <CoreFoundation/CoreFoundation.h>
#include <Security/Security.h>
#include <stdlib.h>
static CFMutableDictionaryRef query(const char *id) {
 CFMutableDictionaryRef q=CFDictionaryCreateMutable(NULL,0,&kCFTypeDictionaryKeyCallBacks,&kCFTypeDictionaryValueCallBacks);
 CFStringRef account=CFStringCreateWithCString(NULL,id,kCFStringEncodingUTF8);
 CFDictionarySetValue(q,kSecClass,kSecClassGenericPassword);
 CFDictionarySetValue(q,kSecAttrService,CFSTR("dev.actdock.secrets"));
 CFDictionarySetValue(q,kSecAttrAccount,account);CFRelease(account);
 CFDictionarySetValue(q,kSecUseAuthenticationUI,kSecUseAuthenticationUIFail);
 return q;
}
static OSStatus put(const char *id,const void *data,long len){
 CFMutableDictionaryRef q=query(id);
 CFDataRef value=CFDataCreate(NULL,data,len);
 CFMutableDictionaryRef attrs=CFDictionaryCreateMutable(NULL,0,&kCFTypeDictionaryKeyCallBacks,&kCFTypeDictionaryValueCallBacks);
 CFDictionarySetValue(attrs,kSecValueData,value);
 OSStatus s=SecItemUpdate(q,attrs);
 if(s==errSecItemNotFound){CFDictionarySetValue(q,kSecValueData,value);s=SecItemAdd(q,NULL);}
 CFRelease(q);CFRelease(attrs);CFRelease(value);return s;
}
static OSStatus get(const char *id,CFTypeRef *out){CFMutableDictionaryRef q=query(id);CFDictionarySetValue(q,kSecReturnData,kCFBooleanTrue);OSStatus s=SecItemCopyMatching(q,out);CFRelease(q);return s;}
static OSStatus del(const char *id){CFMutableDictionaryRef q=query(id);OSStatus s=SecItemDelete(q);CFRelease(q);return s;}
*/
import "C"
import "unsafe"

func status(s C.OSStatus) error {
	if s == 0 {
		return nil
	}
	if s == C.errSecItemNotFound {
		return fail("SECRET_NOT_FOUND")
	}
	if s == C.errSecInteractionNotAllowed || s == C.errSecAuthFailed {
		return fail("VAULT_LOCKED")
	}
	return fail("VAULT_UNAVAILABLE")
}
func vaultStatus() error {
	var ref C.CFTypeRef
	id := C.CString("actdock-status-probe")
	defer C.free(unsafe.Pointer(id))
	s := C.get(id, &ref)
	if s == C.errSecItemNotFound {
		return nil
	}
	if s == 0 {
		C.CFRelease(ref)
	}
	return status(s)
}
func vaultPut(id, value string) error {
	key := C.CString(id)
	defer C.free(unsafe.Pointer(key))
	bytes := []byte(value)
	ptr := C.CBytes(bytes)
	defer C.free(ptr)
	return status(C.put(key, ptr, C.long(len(bytes))))
}
func vaultGet(id string) (string, error) {
	key := C.CString(id)
	defer C.free(unsafe.Pointer(key))
	var ref C.CFTypeRef
	if err := status(C.get(key, &ref)); err != nil {
		return "", err
	}
	defer C.CFRelease(ref)
	d := C.CFDataRef(ref)
	return string(C.GoBytes(unsafe.Pointer(C.CFDataGetBytePtr(d)), C.int(C.CFDataGetLength(d)))), nil
}
func vaultDelete(id string) error {
	key := C.CString(id)
	defer C.free(unsafe.Pointer(key))
	err := status(C.del(key))
	if err != nil && err.Error() == "SECRET_NOT_FOUND" {
		return nil
	}
	return err
}
