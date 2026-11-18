; Uninstalling removes the start-with-Windows entry the assistant wrote (see src/autostart.cjs).
; An upgrade runs the old uninstaller too and must keep the user's choice.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Foart"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "Foart"
  ${endIf}
!macroend
