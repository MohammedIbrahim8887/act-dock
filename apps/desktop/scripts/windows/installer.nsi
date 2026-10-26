Unicode true
!include "MUI2.nsh"
!include "FileFunc.nsh"
Name "Act Dock"
OutFile "/out/windows-x64-ActDock-Setup.exe"
InstallDir "$LOCALAPPDATA\Programs\Act Dock"
RequestExecutionLevel user
SetCompressor /SOLID lzma
!define MUI_ICON "/payload/icon.ico"
!define MUI_UNICON "/payload/icon.ico"
!define MUI_WELCOMEFINISHPAGE_BITMAP "/usr/share/nsis/Contrib/Graphics/Wizard/nsis3-grey.bmp"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "Your pipelines. Right here."
!define MUI_WELCOMEPAGE_TEXT "Install Act Dock ${APP_VERSION} for your Windows account.$\r$\n$\r$\nRun local GitHub Actions, follow live output, and connect your AI agents.$\r$\n$\r$\nIncludes the act engine. Requires Docker and Microsoft Edge WebView2."
!define MUI_FINISHPAGE_RUN "$INSTDIR\bin\Act Dock.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Open Act Dock"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"
Section "Act Dock"
  SetShellVarContext current
  SetOutPath "$INSTDIR"
  File /r "/payload/Act Dock/*"
  File /oname=ActDock.ico "/payload/icon.ico"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateDirectory "$SMPROGRAMS\Act Dock"
  CreateShortcut "$SMPROGRAMS\Act Dock\Act Dock.lnk" "$INSTDIR\bin\Act Dock.exe" "" "$INSTDIR\ActDock.ico"
  CreateShortcut "$DESKTOP\Act Dock.lnk" "$INSTDIR\bin\Act Dock.exe" "" "$INSTDIR\ActDock.ico"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ActDock" "DisplayName" "Act Dock"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ActDock" "DisplayVersion" "${APP_VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ActDock" "Publisher" "Mohammed Ibrahim"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ActDock" "DisplayIcon" "$INSTDIR\ActDock.ico"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ActDock" "UninstallString" '"$INSTDIR\Uninstall.exe"'
SectionEnd
Section "Uninstall"
  SetShellVarContext current
  Delete "$DESKTOP\Act Dock.lnk"
  RMDir /r "$SMPROGRAMS\Act Dock"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ActDock"
SectionEnd
