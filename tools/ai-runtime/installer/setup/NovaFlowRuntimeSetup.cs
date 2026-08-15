using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;
using System.Windows.Forms;

namespace NovaFlow.AiRuntimeSetup
{
    internal static class Program
    {
        [STAThread]
        private static int Main(string[] args)
        {
            if (args.Length > 0)
            {
                return RunSilentInstall(args);
            }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new SetupForm());
            return 0;
        }

        private static int RunSilentInstall(string[] args)
        {
            try
            {
                if (!IsInstallArgument(args[0]))
                {
                    return 2;
                }

                string runtimePath = GetArgumentValue(args, "--runtime");
                string assetsPath = GetArgumentValue(args, "--assets");
                if (runtimePath == null || assetsPath == null)
                {
                    return 2;
                }

                var reporter = new BackgroundWorker();
                reporter.WorkerReportsProgress = true;
                SetupForm.InstallRuntime(new InstallRequest(runtimePath, assetsPath), reporter);
                return 0;
            }
            catch
            {
                return 1;
            }
        }

        private static bool IsInstallArgument(string value)
        {
            return string.Equals(value, "--install", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(value, "/install", StringComparison.OrdinalIgnoreCase);
        }

        private static string GetArgumentValue(string[] args, string name)
        {
            for (int i = 0; i < args.Length - 1; i++)
            {
                if (string.Equals(args[i], name, StringComparison.OrdinalIgnoreCase))
                {
                    return args[i + 1];
                }
            }
            return null;
        }
    }

    internal sealed class SetupForm : Form
    {
        private readonly TextBox runtimePathTextBox;
        private readonly TextBox assetsPathTextBox;
        private readonly Button browseRuntimeButton;
        private readonly Button browseAssetsButton;
        private readonly Button installButton;
        private readonly Button cancelButton;
        private readonly Label statusLabel;
        private readonly BackgroundWorker worker;

        public SetupForm()
        {
            Text = "NovaFlow AI Runtime Setup";
            Font = new Font("Segoe UI", 9F);
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            ClientSize = new Size(620, 230);

            var titleLabel = new Label();
            titleLabel.Text = "NovaFlow AI Runtime Setup";
            titleLabel.Font = new Font("Segoe UI", 14F, FontStyle.Bold);
            titleLabel.AutoSize = true;
            titleLabel.Location = new Point(24, 20);
            Controls.Add(titleLabel);

            var runtimeLabel = new Label();
            runtimeLabel.Text = "Runtime " + U("5B89", "88C5", "76EE", "5F55") + ":";
            runtimeLabel.AutoSize = true;
            runtimeLabel.Location = new Point(26, 68);
            Controls.Add(runtimeLabel);

            runtimePathTextBox = new TextBox();
            runtimePathTextBox.Name = "RuntimePathTextBox";
            runtimePathTextBox.AccessibleName = "RuntimePathTextBox";
            runtimePathTextBox.Location = new Point(146, 64);
            runtimePathTextBox.Size = new Size(365, 23);
            runtimePathTextBox.Text = @"C:\ProgramData\NovaFlow\AI-Runtime";
            Controls.Add(runtimePathTextBox);

            browseRuntimeButton = new Button();
            browseRuntimeButton.Name = "BrowseRuntimeButton";
            browseRuntimeButton.AccessibleName = "BrowseRuntimeButton";
            browseRuntimeButton.Text = U("6D4F", "89C8");
            browseRuntimeButton.Location = new Point(523, 62);
            browseRuntimeButton.Size = new Size(72, 27);
            browseRuntimeButton.Click += delegate { BrowseForFolder(runtimePathTextBox); };
            Controls.Add(browseRuntimeButton);

            var assetsLabel = new Label();
            assetsLabel.Text = U("8D44", "6E90", "76EE", "5F55") + ":";
            assetsLabel.AutoSize = true;
            assetsLabel.Location = new Point(26, 107);
            Controls.Add(assetsLabel);

            assetsPathTextBox = new TextBox();
            assetsPathTextBox.Name = "AssetsPathTextBox";
            assetsPathTextBox.AccessibleName = "AssetsPathTextBox";
            assetsPathTextBox.Location = new Point(146, 103);
            assetsPathTextBox.Size = new Size(365, 23);
            assetsPathTextBox.Text = Directory.Exists(@"D:\") ? @"D:\NovaFlow" : @"C:\ProgramData\NovaFlow";
            Controls.Add(assetsPathTextBox);

            browseAssetsButton = new Button();
            browseAssetsButton.Name = "BrowseAssetsButton";
            browseAssetsButton.AccessibleName = "BrowseAssetsButton";
            browseAssetsButton.Text = U("6D4F", "89C8");
            browseAssetsButton.Location = new Point(523, 101);
            browseAssetsButton.Size = new Size(72, 27);
            browseAssetsButton.Click += delegate { BrowseForFolder(assetsPathTextBox); };
            Controls.Add(browseAssetsButton);

            statusLabel = new Label();
            statusLabel.AutoEllipsis = true;
            statusLabel.Location = new Point(29, 148);
            statusLabel.Size = new Size(565, 24);
            Controls.Add(statusLabel);

            installButton = new Button();
            installButton.Name = "InstallButton";
            installButton.AccessibleName = "InstallButton";
            installButton.Text = U("5B89", "88C5");
            installButton.Location = new Point(421, 183);
            installButton.Size = new Size(82, 30);
            installButton.Click += InstallButton_Click;
            Controls.Add(installButton);

            cancelButton = new Button();
            cancelButton.Name = "CancelButton";
            cancelButton.AccessibleName = "CancelButton";
            cancelButton.Text = U("53D6", "6D88");
            cancelButton.Location = new Point(513, 183);
            cancelButton.Size = new Size(82, 30);
            cancelButton.Click += delegate { Close(); };
            Controls.Add(cancelButton);

            worker = new BackgroundWorker();
            worker.WorkerReportsProgress = true;
            worker.DoWork += Worker_DoWork;
            worker.ProgressChanged += delegate(object sender, ProgressChangedEventArgs e)
            {
                statusLabel.Text = Convert.ToString(e.UserState);
            };
            worker.RunWorkerCompleted += Worker_RunWorkerCompleted;
        }

        private void BrowseForFolder(TextBox target)
        {
            using (var dialog = new FolderBrowserDialog())
            {
                dialog.ShowNewFolderButton = true;
                dialog.SelectedPath = target.Text;
                if (dialog.ShowDialog(this) == DialogResult.OK)
                {
                    target.Text = dialog.SelectedPath;
                }
            }
        }

        private void InstallButton_Click(object sender, EventArgs e)
        {
            if (worker.IsBusy)
            {
                return;
            }

            string runtimePath = runtimePathTextBox.Text.Trim();
            string assetsPath = assetsPathTextBox.Text.Trim();
            if (runtimePath.Length == 0 || assetsPath.Length == 0)
            {
                MessageBox.Show(this, U("8BF7", "9009", "62E9", "5B8C", "6574", "7684", "76EE", "5F55", "3002"), Text, MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }

            SetInstallingState(true);
            worker.RunWorkerAsync(new InstallRequest(runtimePath, assetsPath));
        }

        private void Worker_DoWork(object sender, DoWorkEventArgs e)
        {
            var request = (InstallRequest)e.Argument;
            var reporter = (BackgroundWorker)sender;
            InstallRuntime(request, reporter);
            e.Result = request;
        }

        private void Worker_RunWorkerCompleted(object sender, RunWorkerCompletedEventArgs e)
        {
            if (e.Error != null)
            {
                SetInstallingState(false);
                statusLabel.Text = "";
                MessageBox.Show(this, e.Error.Message, Text, MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }

            var request = (InstallRequest)e.Result;
            ShowSuccess(request.RuntimePath, request.AssetsPath);
        }

        private void SetInstallingState(bool installing)
        {
            runtimePathTextBox.Enabled = !installing;
            assetsPathTextBox.Enabled = !installing;
            browseRuntimeButton.Enabled = !installing;
            browseAssetsButton.Enabled = !installing;
            installButton.Enabled = !installing;
            cancelButton.Enabled = !installing;
            statusLabel.Text = installing ? U("6B63", "5728", "5B89", "88C5", "002E", "002E", "002E") : "";
        }

        private void ShowSuccess(string runtimePath, string assetsPath)
        {
            Controls.Clear();
            ClientSize = new Size(620, 260);

            var titleLabel = new Label();
            titleLabel.Text = U("5B89", "88C5", "6210", "529F");
            titleLabel.Font = new Font("Segoe UI", 16F, FontStyle.Bold);
            titleLabel.AutoSize = true;
            titleLabel.Location = new Point(26, 24);
            Controls.Add(titleLabel);

            var runtimeLabel = new Label();
            runtimeLabel.Text = "Runtime:";
            runtimeLabel.AutoSize = true;
            runtimeLabel.Location = new Point(29, 80);
            Controls.Add(runtimeLabel);

            var runtimeValue = new Label();
            runtimeValue.Text = runtimePath;
            runtimeValue.AutoEllipsis = true;
            runtimeValue.Location = new Point(112, 80);
            runtimeValue.Size = new Size(475, 23);
            Controls.Add(runtimeValue);

            var assetsLabel = new Label();
            assetsLabel.Text = U("8D44", "6E90") + ":";
            assetsLabel.AutoSize = true;
            assetsLabel.Location = new Point(29, 120);
            Controls.Add(assetsLabel);

            var assetsValue = new Label();
            assetsValue.Text = assetsPath;
            assetsValue.AutoEllipsis = true;
            assetsValue.Location = new Point(112, 120);
            assetsValue.Size = new Size(475, 23);
            Controls.Add(assetsValue);

            var finishButton = new Button();
            finishButton.Name = "FinishButton";
            finishButton.AccessibleName = "FinishButton";
            finishButton.Text = U("5B8C", "6210");
            finishButton.Location = new Point(505, 205);
            finishButton.Size = new Size(82, 30);
            finishButton.Click += delegate { Close(); };
            Controls.Add(finishButton);

            AcceptButton = finishButton;
        }

        internal static void InstallRuntime(InstallRequest request, BackgroundWorker reporter)
        {
            string setupDirectory = AppDomain.CurrentDomain.BaseDirectory;
            string sourceRuntime = Path.Combine(setupDirectory, "Runtime");
            sourceRuntime = Path.Combine(sourceRuntime, "AI-Runtime");
            if (!Directory.Exists(sourceRuntime))
            {
                throw new DirectoryNotFoundException("Runtime source was not found: " + sourceRuntime);
            }
            if (!File.Exists(Path.Combine(sourceRuntime, "scripts\\start-runtime.bat")))
            {
                throw new FileNotFoundException("Runtime source is incomplete. Missing scripts\\start-runtime.bat.");
            }

            string runtimePath = Path.GetFullPath(request.RuntimePath);
            string assetsPath = Path.GetFullPath(request.AssetsPath);
            string modelsPath = Path.Combine(assetsPath, "models");
            string customNodesPath = Path.Combine(assetsPath, "custom_nodes");

            reporter.ReportProgress(0, U("6B63", "5728", "590D", "5236", "0020", "Runtime", "002E", "002E", "002E"));
            CopyDirectory(sourceRuntime, runtimePath, reporter);

            reporter.ReportProgress(0, U("6B63", "5728", "521B", "5EFA", "8D44", "6E90", "76EE", "5F55", "002E", "002E", "002E"));
            Directory.CreateDirectory(Path.Combine(modelsPath, "checkpoints"));
            Directory.CreateDirectory(Path.Combine(modelsPath, "loras"));
            Directory.CreateDirectory(Path.Combine(modelsPath, "vae"));
            Directory.CreateDirectory(Path.Combine(modelsPath, "controlnet"));
            Directory.CreateDirectory(Path.Combine(modelsPath, "rembg"));
            Directory.CreateDirectory(customNodesPath);
            Directory.CreateDirectory(Path.Combine(runtimePath, "logs"));

            reporter.ReportProgress(0, U("6B63", "5728", "5199", "5165", "0020", "runtime.json", "002E", "002E", "002E"));
            string version = ReadRuntimeVersion(Path.Combine(sourceRuntime, "runtime.json"));
            File.WriteAllText(Path.Combine(runtimePath, "runtime.json"), BuildRuntimeJson(version, runtimePath, assetsPath, modelsPath, customNodesPath), new UTF8Encoding(false));
            WriteRuntimeScriptShim(runtimePath, "start-runtime.bat");
            WriteRuntimeScriptShim(runtimePath, "stop-runtime.bat");
            WriteRuntimeScriptShim(runtimePath, "check-runtime.bat");
        }

        private static void WriteRuntimeScriptShim(string runtimePath, string scriptName)
        {
            string content = string.Join(Environment.NewLine, new[]
            {
                "@echo off",
                "setlocal",
                "set \"SCRIPT_DIR=%~dp0\"",
                "call \"%SCRIPT_DIR%scripts\\" + scriptName + "\" %*",
                "exit /b %ERRORLEVEL%"
            }) + Environment.NewLine;
            File.WriteAllText(Path.Combine(runtimePath, scriptName), content, Encoding.ASCII);
        }

        private static void CopyDirectory(string sourceDirectory, string destinationDirectory, BackgroundWorker reporter)
        {
            Directory.CreateDirectory(destinationDirectory);
            reporter.ReportProgress(0, U("6B63", "5728", "590D", "5236", "0020", "Runtime", "0020", "6587", "4EF6", "002E", "002E", "002E"));

            var startInfo = new ProcessStartInfo();
            startInfo.FileName = "robocopy.exe";
            startInfo.Arguments = Quote(sourceDirectory) + " " + Quote(destinationDirectory) + " /E /R:2 /W:1 /NFL /NDL /NJH /NJS /NP";
            startInfo.UseShellExecute = false;
            startInfo.CreateNoWindow = true;

            using (Process process = Process.Start(startInfo))
            {
                process.WaitForExit();
                if (process.ExitCode > 7)
                {
                    throw new InvalidOperationException("Runtime copy failed. robocopy exit code: " + process.ExitCode.ToString());
                }
            }
        }

        private static string Quote(string value)
        {
            string fullPath = Path.GetFullPath(value);
            string root = Path.GetPathRoot(fullPath);
            if (string.Equals(fullPath, root, StringComparison.OrdinalIgnoreCase))
            {
                return "\"" + fullPath + "\"";
            }
            return "\"" + fullPath.TrimEnd('\\') + "\"";
        }

        private static string ReadRuntimeVersion(string runtimeJsonPath)
        {
            if (!File.Exists(runtimeJsonPath))
            {
                return "0.2.2";
            }
            string text = File.ReadAllText(runtimeJsonPath);
            Match match = Regex.Match(text, "\"version\"\\s*:\\s*\"([^\"]+)\"");
            if (!match.Success)
            {
                return "0.2.2";
            }
            return match.Groups[1].Value;
        }

        private static string BuildRuntimeJson(string version, string installPath, string assetsPath, string modelsPath, string customNodesPath)
        {
            var builder = new StringBuilder();
            builder.AppendLine("{");
            builder.AppendLine("  \"name\": \"NovaFlow AI Runtime\",");
            builder.AppendLine("  \"version\": \"" + EscapeJson(version) + "\",");
            builder.AppendLine("  \"engine\": \"comfyui-core\",");
            builder.AppendLine("  \"port\": 8188,");
            builder.AppendLine("  \"installPath\": \"" + EscapeJson(installPath) + "\",");
            builder.AppendLine("  \"assetsPath\": \"" + EscapeJson(assetsPath) + "\",");
            builder.AppendLine("  \"modelsPath\": \"" + EscapeJson(modelsPath) + "\",");
            builder.AppendLine("  \"customNodesPath\": \"" + EscapeJson(customNodesPath) + "\"");
            builder.AppendLine("}");
            return builder.ToString();
        }

        private static string EscapeJson(string value)
        {
            return value.Replace("\\", "\\\\").Replace("\"", "\\\"");
        }

        private static string U(params string[] hexCodes)
        {
            var builder = new StringBuilder();
            for (int i = 0; i < hexCodes.Length; i++)
            {
                string code = hexCodes[i];
                if (code.Length == 1)
                {
                    builder.Append(code);
                }
                else if (IsHexCode(code))
                {
                    builder.Append((char)Convert.ToInt32(code, 16));
                }
                else
                {
                    builder.Append(code);
                }
            }
            return builder.ToString();
        }

        private static bool IsHexCode(string value)
        {
            if (value.Length < 2 || value.Length > 4)
            {
                return false;
            }
            for (int i = 0; i < value.Length; i++)
            {
                char c = value[i];
                bool isHex = (c >= '0' && c <= '9') || (c >= 'A' && c <= 'F') || (c >= 'a' && c <= 'f');
                if (!isHex)
                {
                    return false;
                }
            }
            return true;
        }
    }

    internal sealed class InstallRequest
    {
        public readonly string RuntimePath;
        public readonly string AssetsPath;

        public InstallRequest(string runtimePath, string assetsPath)
        {
            RuntimePath = runtimePath;
            AssetsPath = assetsPath;
        }
    }
}
