Unicode true
Name "NovaFlow AI Runtime"
Caption "NovaFlow AI Runtime Setup ${SETUP_VERSION}"
OutFile "${OUTPUT_EXE}"
InstallDir "${DEFAULT_RUNTIME_DIR}"
RequestExecutionLevel admin
ShowInstDetails show
AutoCloseWindow false
SetCompressor /SOLID lzma

!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "nsDialogs.nsh"

!define MUI_ABORTWARNING
!define MUI_ICON "${NSISDIR}\Contrib\Graphics\Icons\modern-install.ico"
!define MUI_HEADERIMAGE

Var AssetsDir
Var AssetsDirText

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
Page custom AssetsDirPageCreate AssetsDirPageLeave
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_LANGUAGE "English"

Function .onInit
  StrCpy $INSTDIR "${DEFAULT_RUNTIME_DIR}"
  IfFileExists "D:\*.*" 0 NoDDrive
    StrCpy $AssetsDir "D:\NovaFlow"
    Goto Done
  NoDDrive:
    StrCpy $AssetsDir "C:\ProgramData\NovaFlow"
  Done:
FunctionEnd

Function AssetsDirBrowse
  nsDialogs::SelectFolderDialog "Select NovaFlow AI assets directory" "$AssetsDir"
  Pop $0
  ${If} $0 != error
    StrCpy $AssetsDir $0
    ${NSD_SetText} $AssetsDirText "$AssetsDir"
  ${EndIf}
FunctionEnd

Function AssetsDirPageCreate
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 24u "Choose where NovaFlow AI assets should be stored. Models and custom nodes are not included in this setup."
  Pop $0
  ${NSD_CreateDirRequest} 0 36u 78% 13u "$AssetsDir"
  Pop $AssetsDirText
  ${NSD_CreateBrowseButton} 80% 35u 20% 15u "Browse..."
  Pop $0
  ${NSD_OnClick} $0 AssetsDirBrowse

  nsDialogs::Show
FunctionEnd

Function AssetsDirPageLeave
  ${NSD_GetText} $AssetsDirText $AssetsDir
  ${If} $AssetsDir == ""
    MessageBox MB_ICONEXCLAMATION "Please select a NovaFlow AI assets directory."
    Abort
  ${EndIf}
FunctionEnd

Function JsonEscapePath
  Exch $0
  Push $1
  Push $2
  StrCpy $1 ""

  Loop:
    StrCpy $2 $0 1
    StrCmp $2 "" Done
    StrCmp $2 "\" 0 NormalChar
      StrCpy $1 "$1\\"
      Goto NextChar
    NormalChar:
      StrCpy $1 "$1$2"
    NextChar:
      StrCpy $0 $0 "" 1
      Goto Loop

  Done:
    StrCpy $0 $1
    Pop $2
    Pop $1
    Exch $0
FunctionEnd

Section "Install NovaFlow AI Runtime"
  SetOutPath "$INSTDIR"
  File /r "${STAGING_RUNTIME}\*.*"

  CreateDirectory "$INSTDIR\logs"
  CreateDirectory "$INSTDIR\engine\ComfyUI\custom_nodes"

  CreateDirectory "$AssetsDir"
  CreateDirectory "$AssetsDir\models"
  CreateDirectory "$AssetsDir\models\checkpoints"
  CreateDirectory "$AssetsDir\models\loras"
  CreateDirectory "$AssetsDir\models\vae"
  CreateDirectory "$AssetsDir\models\controlnet"
  CreateDirectory "$AssetsDir\models\rembg"
  CreateDirectory "$AssetsDir\custom_nodes"

  Push "$INSTDIR"
  Call JsonEscapePath
  Pop $R0

  Push "$AssetsDir"
  Call JsonEscapePath
  Pop $R1

  StrCpy $R2 "$AssetsDir\models"
  Push "$R2"
  Call JsonEscapePath
  Pop $R2

  StrCpy $R3 "$AssetsDir\custom_nodes"
  Push "$R3"
  Call JsonEscapePath
  Pop $R3

  FileOpen $9 "$INSTDIR\runtime.json" w
  FileWrite $9 "{$\r$\n"
  FileWrite $9 '  "name": "NovaFlow AI Runtime",$\r$\n'
  FileWrite $9 '  "version": "${RUNTIME_VERSION}",$\r$\n'
  FileWrite $9 '  "engine": "comfyui-core",$\r$\n'
  FileWrite $9 '  "port": 8188,$\r$\n'
  FileWrite $9 '  "installPath": "$R0",$\r$\n'
  FileWrite $9 '  "assetsPath": "$R1",$\r$\n'
  FileWrite $9 '  "modelsPath": "$R2",$\r$\n'
  FileWrite $9 '  "customNodesPath": "$R3"$\r$\n'
  FileWrite $9 "}$\r$\n"
  FileClose $9
SectionEnd
