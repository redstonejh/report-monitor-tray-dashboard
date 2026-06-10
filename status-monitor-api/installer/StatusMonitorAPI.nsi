; ════════════════════════════════════════════════════════════════════════════════
; Status Monitor API - Windows Installer
; Installs the Node.js API as an auto-starting Windows service via NSSM.
; Prerequisites: run build-api-installer.sh first to create staging/.
; ════════════════════════════════════════════════════════════════════════════════

!include "MUI2.nsh"
!include "nsDialogs.nsh"
!include "LogicLib.nsh"

; ── Metadata ──────────────────────────────────────────────────────────────────
!define APP_NAME      "Status Monitor API"
!define APP_VERSION   "1.0.0"
!define APP_PUBLISHER "Status Monitor"
!define SVC_NAME      "StatusMonitorAPI"
!define UNREG_KEY     "Software\Microsoft\Windows\CurrentVersion\Uninstall\${SVC_NAME}"

Name             "${APP_NAME} ${APP_VERSION}"
OutFile          "../../dist/StatusMonitorAPI-Setup.exe"
InstallDir       "$PROGRAMFILES64\StatusMonitorAPI"
InstallDirRegKey HKLM "Software\${SVC_NAME}" "InstallDir"
RequestExecutionLevel admin
ShowInstDetails  show
ShowUnInstDetails show

; ── Config page variables ──────────────────────────────────────────────────────
Var Dlg
Var DbPathCtrl
Var BasePathCtrl
Var MqttHostCtrl
Var MqttPortCtrl
Var MqttWsPortCtrl

Var DbPath
Var BasePath
Var MqttHost
Var MqttPort
Var MqttWsPort

; ── Pages ──────────────────────────────────────────────────────────────────────
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_NOAUTOCLOSE
!define MUI_FINISHPAGE_TEXT "Status Monitor API is installed and running.$\n$\nThe service (${SVC_NAME}) starts automatically with Windows.$\n$\nTo change settings after install: edit .env in the install folder, then restart the service in services.msc."

!insertmacro MUI_PAGE_WELCOME
Page custom ConfigPage ConfigPageLeave
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

; ── Pre-fill from previous install ────────────────────────────────────────────
Function .onInit
  ReadRegStr $DbPath    HKLM "Software\${SVC_NAME}" "DbPath"
  ReadRegStr $BasePath  HKLM "Software\${SVC_NAME}" "BasePath"
  ReadRegStr $MqttHost  HKLM "Software\${SVC_NAME}" "MqttHost"
  ReadRegStr $MqttPort  HKLM "Software\${SVC_NAME}" "MqttPort"
  ReadRegStr $MqttWsPort HKLM "Software\${SVC_NAME}" "MqttWsPort"

  ${If} $DbPath == ""
    StrCpy $DbPath ""
  ${EndIf}
  ${If} $MqttHost == ""
    StrCpy $MqttHost "localhost"
  ${EndIf}
  ${If} $MqttPort == ""
    StrCpy $MqttPort "1883"
  ${EndIf}
  ${If} $MqttWsPort == ""
    StrCpy $MqttWsPort "9001"
  ${EndIf}
FunctionEnd

; ── Config page ───────────────────────────────────────────────────────────────
Function ConfigPage
  !insertmacro MUI_HEADER_TEXT "Monitor Configuration" "Set optional source locations and MQTT broker connection."

  nsDialogs::Create 1018
  Pop $Dlg
  ${If} $Dlg == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0u 100% 10u "Database path (optional absolute path to a SQLite status/source database):"
  Pop $0
  ${NSD_CreateText} 0 12u 100% 13u $DbPath
  Pop $DbPathCtrl

  ${NSD_CreateLabel} 0 32u 100% 10u "Source base path (shared folder containing raw data, report, and log subfolders - leave blank if unused):"
  Pop $0
  ${NSD_CreateText} 0 44u 100% 13u $BasePath
  Pop $BasePathCtrl

  ${NSD_CreateLabel} 0 64u 100% 10u "MQTT broker:"
  Pop $0

  ${NSD_CreateLabel}  0   77u 52% 10u "Host"
  Pop $0
  ${NSD_CreateText}   0   89u 52% 13u $MqttHost
  Pop $MqttHostCtrl

  ${NSD_CreateLabel} 55%  77u 20% 10u "Port"
  Pop $0
  ${NSD_CreateText}  55%  89u 20% 13u $MqttPort
  Pop $MqttPortCtrl

  ${NSD_CreateLabel} 78%  77u 22% 10u "WebSocket port"
  Pop $0
  ${NSD_CreateText}  78%  89u 22% 13u $MqttWsPort
  Pop $MqttWsPortCtrl

  nsDialogs::Show
FunctionEnd

Function ConfigPageLeave
  ${NSD_GetText} $DbPathCtrl     $DbPath
  ${NSD_GetText} $BasePathCtrl   $BasePath
  ${NSD_GetText} $MqttHostCtrl   $MqttHost
  ${NSD_GetText} $MqttPortCtrl   $MqttPort
  ${NSD_GetText} $MqttWsPortCtrl $MqttWsPort

FunctionEnd

; ── Install ────────────────────────────────────────────────────────────────────
Section "${APP_NAME}" SEC_MAIN

  ; Stop & remove any existing service (upgrade-safe)
  nsExec::Exec '"$INSTDIR\${SVC_NAME}.exe" stop'
  nsExec::Exec '"$INSTDIR\${SVC_NAME}.exe" uninstall'

  ; Extract staged files
  SetOutPath "$INSTDIR"
  File /r "staging/node"
  File /r "staging/app"
  File     "staging/${SVC_NAME}.exe"

  ; Create logs directory
  CreateDirectory "$INSTDIR\logs"

  ; Write .env
  FileOpen  $0 "$INSTDIR\.env" w
  FileWrite $0 "DB_PATH=$DbPath$\r$\n"
  FileWrite $0 "BASE_PATH=$BasePath$\r$\n"
  FileWrite $0 "RAW_DATA_PATH=raw$\r$\n"
  FileWrite $0 "ARCHIVED_DATA_PATH=archive$\r$\n"
  FileWrite $0 "REPORT_WORK_PATH=reports\work$\r$\n"
  FileWrite $0 "REPORT_SUMMARY_PATH=reports\summary$\r$\n"
  FileWrite $0 "REPORT_FINAL_PATH=reports\final$\r$\n"
  FileWrite $0 "SOURCE_LOG_PATH=logs$\r$\n"
  FileWrite $0 "RAW_DATA_EXTENSIONS=.csv,.log,.txt$\r$\n"
  FileWrite $0 "REPORT_EXTENSIONS=.xlsx,.xls,.txt,.pdf$\r$\n"
  FileWrite $0 "DB_TABLE=StatusRecords$\r$\n"
  FileWrite $0 "DB_DATE_COLUMN=RecordDate$\r$\n"
  FileWrite $0 "GREEN_THRESHOLD_HOURS=26$\r$\n"
  FileWrite $0 "MQTT_BROKER_HOST=$MqttHost$\r$\n"
  FileWrite $0 "MQTT_BROKER_PORT=$MqttPort$\r$\n"
  FileWrite $0 "MQTT_WS_PORT=$MqttWsPort$\r$\n"
  FileWrite $0 "MQTT_USERNAME=$\r$\n"
  FileWrite $0 "MQTT_PASSWORD=$\r$\n"
  FileWrite $0 "CHECK_CRON=*/10 * * * *$\r$\n"
  FileWrite $0 "API_PORT=3847$\r$\n"
  FileWrite $0 "API_CORS_ORIGIN=*$\r$\n"
  FileClose $0

  ; Write WinSW service descriptor
  FileOpen  $0 "$INSTDIR\${SVC_NAME}.xml" w
  FileWrite $0 "<service>$\r$\n"
  FileWrite $0 "  <id>${SVC_NAME}</id>$\r$\n"
  FileWrite $0 "  <name>${APP_NAME}</name>$\r$\n"
  FileWrite $0 "  <description>Generic status monitor API</description>$\r$\n"
  FileWrite $0 "  <executable>$INSTDIR\node\node.exe</executable>$\r$\n"
  FileWrite $0 "  <arguments>src\index.js</arguments>$\r$\n"
  FileWrite $0 "  <workingdirectory>$INSTDIR\app</workingdirectory>$\r$\n"
  FileWrite $0 "  <startmode>Automatic</startmode>$\r$\n"
  FileWrite $0 "  <logpath>$INSTDIR\logs</logpath>$\r$\n"
  FileWrite $0 "  <log mode=$\"roll-by-size$\">$\r$\n"
  FileWrite $0 "    <sizeThreshold>10240</sizeThreshold>$\r$\n"
  FileWrite $0 "    <keepFiles>5</keepFiles>$\r$\n"
  FileWrite $0 "  </log>$\r$\n"
  FileWrite $0 "  <onfailure action=$\"restart$\" delay=$\"10 sec$\"/>$\r$\n"
  FileWrite $0 "  <onfailure action=$\"restart$\" delay=$\"30 sec$\"/>$\r$\n"
  FileWrite $0 "  <onfailure action=$\"none$\"/>$\r$\n"
  FileWrite $0 "</service>$\r$\n"
  FileClose $0

  ; Register and start Windows service
  DetailPrint "Registering Windows service…"
  nsExec::ExecToLog '"$INSTDIR\${SVC_NAME}.exe" install'
  nsExec::ExecToLog '"$INSTDIR\${SVC_NAME}.exe" start'

  ; Save settings for upgrade pre-fill
  WriteRegStr HKLM "Software\${SVC_NAME}" "InstallDir"  "$INSTDIR"
  WriteRegStr HKLM "Software\${SVC_NAME}" "DbPath"      "$DbPath"
  WriteRegStr HKLM "Software\${SVC_NAME}" "BasePath"    "$BasePath"
  WriteRegStr HKLM "Software\${SVC_NAME}" "MqttHost"    "$MqttHost"
  WriteRegStr HKLM "Software\${SVC_NAME}" "MqttPort"    "$MqttPort"
  WriteRegStr HKLM "Software\${SVC_NAME}" "MqttWsPort"  "$MqttWsPort"

  ; Add/Remove Programs
  WriteRegStr   HKLM "${UNREG_KEY}" "DisplayName"     "${APP_NAME}"
  WriteRegStr   HKLM "${UNREG_KEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr   HKLM "${UNREG_KEY}" "DisplayVersion"  "${APP_VERSION}"
  WriteRegStr   HKLM "${UNREG_KEY}" "Publisher"       "${APP_PUBLISHER}"
  WriteRegDWORD HKLM "${UNREG_KEY}" "NoModify"        1
  WriteRegDWORD HKLM "${UNREG_KEY}" "NoRepair"        1

  WriteUninstaller "$INSTDIR\Uninstall.exe"
SectionEnd

; ── Uninstall ──────────────────────────────────────────────────────────────────
Section "Uninstall"
  nsExec::ExecToLog '"$INSTDIR\${SVC_NAME}.exe" stop'
  nsExec::ExecToLog '"$INSTDIR\${SVC_NAME}.exe" uninstall'

  RMDir /r "$INSTDIR\node"
  RMDir /r "$INSTDIR\app"
  Delete    "$INSTDIR\${SVC_NAME}.exe"
  Delete    "$INSTDIR\${SVC_NAME}.xml"
  Delete    "$INSTDIR\Uninstall.exe"
  ; .env and logs\ are intentionally preserved so reinstalling keeps config and history

  DeleteRegKey HKLM "${UNREG_KEY}"
  DeleteRegKey HKLM "Software\${SVC_NAME}"

  RMDir "$INSTDIR"
SectionEnd
