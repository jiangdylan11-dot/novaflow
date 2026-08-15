Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

baseDir = fso.GetParentFolderName(WScript.ScriptFullName)

desktopDir = fso.BuildPath(baseDir, "particle-editor-desktop")
If fso.FolderExists(desktopDir) Then
  shell.CurrentDirectory = desktopDir
Else
  shell.CurrentDirectory = baseDir
End If

cmd = "cmd /c npm run license:gui"
shell.Run cmd, 0, False

