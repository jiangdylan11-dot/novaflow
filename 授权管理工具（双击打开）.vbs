Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

baseDir = fso.GetParentFolderName(WScript.ScriptFullName)

desktopDir = fso.BuildPath(baseDir, "novaflow-web\admin")
If fso.FolderExists(desktopDir) Then
  shell.CurrentDirectory = desktopDir
Else
  shell.CurrentDirectory = baseDir
End If

cmd = "cmd /c npm start"
shell.Run cmd, 0, False

