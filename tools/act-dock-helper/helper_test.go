package main

import (
 "archive/tar"
 "encoding/json"
 "io"
 "os"
 "path/filepath"
 "strings"
 "testing"
)
func TestPrivateFileDoesNotOverwrite(t *testing.T){p:=filepath.Join(t.TempDir(),"private");if err:=privateFile(p,[]byte("canary"));err!=nil{t.Fatal(err)};if err:=privateFile(p,[]byte("replaced"));err==nil{t.Fatal("must reject overwriting a private file")}}
func TestImageAliasPreservesLayers(t *testing.T){
 dir:=t.TempDir();source:=filepath.Join(dir,"source.tar");output:=filepath.Join(dir,"alias.tar");file,err:=os.Create(source);if err!=nil{t.Fatal(err)};w:=tar.NewWriter(file)
 for name,content:=range map[string]string{"manifest.json":`[{"Config":"config.json","RepoTags":["old:tag"],"Layers":["layer.tar"]}]`,"config.json":`{"architecture":"amd64","os":"linux"}`,"layer.tar":"layer bytes"}{if err:=w.WriteHeader(&tar.Header{Name:name,Mode:0600,Size:int64(len(content))});err!=nil{t.Fatal(err)};w.Write([]byte(content))};w.Close();file.Close()
 if err:=rewriteImage(Request{Source:source,Path:output,Alias:"act-dock-local:variant"});err!=nil{t.Fatal(err)}
 f,_:=os.Open(output);defer f.Close();r:=tar.NewReader(f);seen:=0
 for {header,err:=r.Next();if err==io.EOF{break};if err!=nil{t.Fatal(err)};data,_:=io.ReadAll(r);if header.Name=="manifest.json"{var m []map[string]any;if err=json.Unmarshal(data,&m);err!=nil{t.Fatal(err)};if !strings.Contains(string(data),"act-dock-local:variant"){t.Fatal("missing alias")}};if header.Name=="layer.tar"&&string(data)!="layer bytes"{t.Fatal("layer changed")};seen++};if seen!=3{t.Fatal("archive entries lost")}
}
func TestRejectSecretIDsAndOversize(t *testing.T){for _,id:=range []string{"", "name with spaces","secret\nvalue",strings.Repeat("a",201)}{if _,err:=handle(Request{Op:"vault_get",ID:id});err==nil{t.Fatal("accepted invalid ID")}};if _,err:=handle(Request{Op:"vault_put",ID:"test",Value:strings.Repeat("x",49153)});err==nil{t.Fatal("accepted oversized secret")}}
func TestNativeVaultRoundTrip(t *testing.T){if os.Getenv("ACT_DOCK_TEST_VAULT")!="1"{t.Skip("native vault tests are opt-in")};id:="test-"+strings.ReplaceAll(filepath.Base(t.TempDir()),".","-");value:="canary$VALUE\n"+strings.Repeat("x",48*1024-13);if err:=vaultPut(id,value);err!=nil{t.Fatal(err)};defer vaultDelete(id);got,err:=vaultGet(id);if err!=nil||got!=value{t.Fatal("vault round trip failed")};if err:=vaultDelete(id);err!=nil{t.Fatal(err)};if _,err:=vaultGet(id);err==nil{t.Fatal("deleted secret was readable")}}
