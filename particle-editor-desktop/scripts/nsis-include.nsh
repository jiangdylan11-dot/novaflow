!macro customCheckAppRunning
  DetailPrint "NovaFlow installer: closing stale ${APP_EXECUTABLE_FILENAME} if present."
  nsExec::ExecToStack '"$SYSDIR\cmd.exe" /c taskkill /F /T /IM "${APP_EXECUTABLE_FILENAME}" 2>NUL'
  Pop $0
  Pop $1
  Sleep 500

  ; Older generated uninstallers can return appCannotBeClosed even when no
  ; NovaFlow process remains. Let this installer perform the in-place upgrade.
  DeleteRegKey HKCU "${UNINSTALL_REGISTRY_KEY}"
  DeleteRegKey HKLM "${UNINSTALL_REGISTRY_KEY}"

  ; If the old install directory is still present, remove only NovaFlow app
  ; payload files so the new package can copy into Program Files cleanly.
  RMDir /r "$INSTDIR\locales"
  RMDir /r "$INSTDIR\resources"
  Delete "$INSTDIR\chrome_100_percent.pak"
  Delete "$INSTDIR\chrome_200_percent.pak"
  Delete "$INSTDIR\d3dcompiler_47.dll"
  Delete "$INSTDIR\ffmpeg.dll"
  Delete "$INSTDIR\icudtl.dat"
  Delete "$INSTDIR\libEGL.dll"
  Delete "$INSTDIR\libGLESv2.dll"
  Delete "$INSTDIR\LICENSE.electron.txt"
  Delete "$INSTDIR\LICENSES.chromium.html"
  Delete "$INSTDIR\NovaFlowPortable.exe"
  Delete "$INSTDIR\resources.pak"
  Delete "$INSTDIR\snapshot_blob.bin"
  Delete "$INSTDIR\Uninstall NovaFlowPortable.exe"
  Delete "$INSTDIR\uninstallerIcon.ico"
  Delete "$INSTDIR\v8_context_snapshot.bin"
  Delete "$INSTDIR\vk_swiftshader.dll"
  Delete "$INSTDIR\vk_swiftshader_icd.json"
  Delete "$INSTDIR\vulkan-1.dll"
  ClearErrors
!macroend

!macro customUnInstallCheck
  DetailPrint "NovaFlow installer: old uninstaller result ignored; replacing app files in-place."
  ClearErrors
  StrCpy $R0 0
!macroend

!macro customUnInstallCheckCurrentUser
  DetailPrint "NovaFlow installer: old current-user uninstaller result ignored; replacing app files in-place."
  ClearErrors
  StrCpy $R0 0
!macroend

!macro customInstall
  Delete "$INSTDIR\NovaFlow 授权管理工具.lnk"
  Delete "$INSTDIR\NovaFlow 授权管理工具"
  Delete "$INSTDIR\NovaFlow License Manager.lnk"
  Delete "$INSTDIR\NovaFlow License Manager"

  ${if} ${FileExists} "$INSTDIR\resources\icon.ico"
    ${if} ${FileExists} "$newDesktopLink"
      CreateShortCut "$newDesktopLink" "$appExe" "" "$INSTDIR\resources\icon.ico" 0 "" "" "${APP_DESCRIPTION}"
      ClearErrors
      WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
    ${endIf}

    ${if} ${FileExists} "$newStartMenuLink"
      CreateShortCut "$newStartMenuLink" "$appExe" "" "$INSTDIR\resources\icon.ico" 0 "" "" "${APP_DESCRIPTION}"
      ClearErrors
      WinShell::SetLnkAUMI "$newStartMenuLink" "${APP_ID}"
    ${endIf}

    System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
  ${endIf}
!macroend

!macro customUnInstall
  Delete "$INSTDIR\NovaFlow 授权管理工具.lnk"
  Delete "$INSTDIR\NovaFlow 授权管理工具"
  Delete "$INSTDIR\NovaFlow License Manager.lnk"
  Delete "$INSTDIR\NovaFlow License Manager"
!macroend
