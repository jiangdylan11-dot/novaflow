using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Runtime.Serialization;
using System.Runtime.Serialization.Json;
using System.Text;
using System.Text.RegularExpressions;
using System.Windows.Forms;

namespace NovaFlow.AiRuntimeSetup
{
    [DataContract]
    internal sealed class RuntimeAssetsInfo
    {
        [DataMember(Name = "assetsPath")]
        public string AssetsPath;
    }

    // Keep fields that older and newer installers do not understand when an
    // existing runtime is upgraded. Paths are validated before any copy starts.
    [DataContract]
    internal sealed class RuntimeConfiguration : IExtensibleDataObject
    {
        [DataMember(Name = "name", EmitDefaultValue = false)] public string Name;
        [DataMember(Name = "version", EmitDefaultValue = false)] public string Version;
        [DataMember(Name = "engine", EmitDefaultValue = false)] public string Engine;
        [DataMember(Name = "port", EmitDefaultValue = false)] public int? Port;
        [DataMember(Name = "installPath", EmitDefaultValue = false)] public string InstallPath;
        [DataMember(Name = "assetsPath", EmitDefaultValue = false)] public string AssetsPath;
        [DataMember(Name = "modelsPath", EmitDefaultValue = false)] public string ModelsPath;
        [DataMember(Name = "customNodesPath", EmitDefaultValue = false)] public string CustomNodesPath;
        [DataMember(Name = "useExplicitModelsDirectory", EmitDefaultValue = false)] public bool? UseExplicitModelsDirectory;
        public ExtensionDataObject ExtensionData { get; set; }
    }

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
                // Install from an already present, verified upstream directory;
                // this command does not download or redistribute the files.
                if (string.Equals(args[0], "--install-qwen-cuda-local", StringComparison.OrdinalIgnoreCase))
                {
                    string componentRuntime = GetArgumentValue(args, "--runtime");
                    string componentSource = GetArgumentValue(args, "--component");
                    string componentInventory = GetArgumentValue(args, "--inventory");
                    if (componentRuntime == null || componentSource == null || componentInventory == null) return 2;
                    QwenComponentInstaller.InstallCuda(componentRuntime, componentSource, componentInventory);
                    return 0;
                }
                if (string.Equals(args[0], "--install-qwen-component", StringComparison.OrdinalIgnoreCase))
                {
                    string componentRuntime = GetArgumentValue(args, "--runtime");
                    string componentSource = GetArgumentValue(args, "--component");
                    if (componentRuntime == null || componentSource == null) return 2;
                    QwenComponentInstaller.Install(componentRuntime, componentSource);
                    return 0;
                }
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
            Text = "Foart AI Runtime Setup";
            Font = new Font("Segoe UI", 9F);
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            ClientSize = new Size(620, 230);

            var titleLabel = new Label();
            titleLabel.Text = "Foart AI Runtime Setup";
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
            assetsPathTextBox.Text = ExistingAssetsPath(runtimePathTextBox.Text);
            Controls.Add(assetsPathTextBox);
            bool assetsEdited = false;
            bool changingAssets = false;
            assetsPathTextBox.TextChanged += delegate { if (!changingAssets) assetsEdited = true; };
            runtimePathTextBox.TextChanged += delegate
            {
                if (assetsEdited) return;
                changingAssets = true;
                try { assetsPathTextBox.Text = ExistingAssetsPath(runtimePathTextBox.Text); }
                finally { changingAssets = false; }
            };

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

            // Keep the previous engine and configuration if installation fails.
            // Any older backup is archived instead of being deleted.
            string engineTarget = Path.Combine(runtimePath, "engine");
            string previousEngine = Path.Combine(runtimePath, "engine.previous");
            string oldPrevious = null;
            bool oldPreviousMoved = false;
            string runtimeJson = Path.Combine(runtimePath, "runtime.json");
            byte[] previousRuntimeJson = File.Exists(runtimeJson) ? File.ReadAllBytes(runtimeJson) : null;
            RuntimeConfiguration existingConfig = ReadExistingRuntimeConfiguration(previousRuntimeJson);
            if (existingConfig != null && !String.IsNullOrWhiteSpace(existingConfig.InstallPath) &&
                !SameRuntimePath(ValidatedRuntimePath(existingConfig.InstallPath, "installPath"), runtimePath))
                throw new InvalidDataException("Existing runtime.json points to a different installation directory.");
            if (existingConfig != null && String.IsNullOrWhiteSpace(existingConfig.AssetsPath) &&
                (existingConfig.ModelsPath != null || existingConfig.CustomNodesPath != null || existingConfig.UseExplicitModelsDirectory == true))
                throw new InvalidDataException("Existing runtime.json has custom paths but no valid assetsPath.");
            if (existingConfig != null && !String.IsNullOrWhiteSpace(existingConfig.AssetsPath))
            {
                string oldAssets = ValidatedRuntimePath(existingConfig.AssetsPath, "assetsPath");
                if (SameRuntimePath(oldAssets, assetsPath))
                {
                    if (existingConfig.ModelsPath != null)
                        modelsPath = ValidatedRuntimePath(existingConfig.ModelsPath, "modelsPath");
                    if (existingConfig.CustomNodesPath != null)
                        customNodesPath = ValidatedRuntimePath(existingConfig.CustomNodesPath, "customNodesPath");
                }
                else
                {
                    // A deliberately selected new assets root retains the old
                    // behaviour: both paths follow the selected root.
                    // Keep an explicit false value so extension fields that
                    // followed this property survive DataContract serialization.
                    existingConfig.UseExplicitModelsDirectory = false;
                }
            }
            RuntimeScriptSnapshot[] previousScripts = CaptureRuntimeScripts(runtimePath, sourceRuntime);
            bool engineMoved = false;
            bool copyStarted = false;
            try
            {
                if (Directory.Exists(engineTarget))
                {
                    if (Directory.Exists(previousEngine))
                    {
                        oldPrevious = Path.Combine(runtimePath, "engine.previous-" + Guid.NewGuid().ToString("N"));
                        Directory.Move(previousEngine, oldPrevious);
                        oldPreviousMoved = true;
                    }
                    Directory.Move(engineTarget, previousEngine);
                    engineMoved = true;
                }

                reporter.ReportProgress(0, U("6B63", "5728", "590D", "5236", "0020", "Runtime", "002E", "002E", "002E"));
                copyStarted = true;
                CopyDirectory(sourceRuntime, runtimePath, reporter, true);
                QwenComponentInstaller.PreserveForUpgrade(runtimePath, previousEngine, engineMoved);

                reporter.ReportProgress(0, U("6B63", "5728", "521B", "5EFA", "8D44", "6E90", "76EE", "5F55", "002E", "002E", "002E"));
                Directory.CreateDirectory(Path.Combine(modelsPath, "checkpoints"));
                Directory.CreateDirectory(Path.Combine(modelsPath, "loras"));
                Directory.CreateDirectory(Path.Combine(modelsPath, "vae"));
                Directory.CreateDirectory(Path.Combine(modelsPath, "controlnet"));
                Directory.CreateDirectory(Path.Combine(modelsPath, "rembg"));
                Directory.CreateDirectory(customNodesPath);
                Directory.CreateDirectory(Path.Combine(runtimePath, "logs"));

                // The custom nodes NovaFlow's graphs need ship beside the Runtime; they go into the assets
                // folder ComfyUI reads them from. Nodes the user added there themselves stay untouched.
                string sourceCustomNodes = Path.Combine(Path.Combine(setupDirectory, "Runtime"), "custom_nodes");
                if (Directory.Exists(sourceCustomNodes))
                {
                    CopyDirectory(sourceCustomNodes, customNodesPath, reporter);
                }

                reporter.ReportProgress(0, U("6B63", "5728", "5199", "5165", "0020", "runtime.json", "002E", "002E", "002E"));
                string version = ReadRuntimeVersion(Path.Combine(sourceRuntime, "runtime.json"));
                if (existingConfig == null)
                    File.WriteAllText(runtimeJson, BuildRuntimeJson(version, runtimePath, assetsPath, modelsPath, customNodesPath), new UTF8Encoding(false));
                else
                    File.WriteAllBytes(runtimeJson, BuildUpdatedRuntimeJson(existingConfig, version, runtimePath, assetsPath, modelsPath, customNodesPath));
                WriteRuntimeScriptShim(runtimePath, "start-runtime.bat");
                WriteRuntimeScriptShim(runtimePath, "stop-runtime.bat");
                WriteRuntimeScriptShim(runtimePath, "check-runtime.bat");
            }
            catch (Exception installError)
            {
                string rollbackErrors = "";
                try
                {
                    if (copyStarted && Directory.Exists(engineTarget))
                    {
                        string failedEngine = Path.Combine(runtimePath, "engine.failed-" + Guid.NewGuid().ToString("N"));
                        Directory.Move(engineTarget, failedEngine);
                    }
                    if (engineMoved) Directory.Move(previousEngine, engineTarget);
                }
                catch (Exception error) { rollbackErrors += " engine: " + error.Message; }
                try
                {
                    if (oldPreviousMoved) Directory.Move(oldPrevious, previousEngine);
                }
                catch (Exception error) { rollbackErrors += " previous: " + error.Message; }
                try
                {
                    if (copyStarted)
                    {
                        if (previousRuntimeJson != null) File.WriteAllBytes(runtimeJson, previousRuntimeJson);
                        else if (File.Exists(runtimeJson)) File.Delete(runtimeJson);
                    }
                }
                catch (Exception error) { rollbackErrors += " runtime.json: " + error.Message; }
                if (copyStarted)
                {
                    foreach (RuntimeScriptSnapshot script in previousScripts)
                    {
                        try { RestoreRuntimeScript(script); }
                        catch (Exception error) { rollbackErrors += " script " + script.Path + ": " + error.Message; }
                    }
                }
                if (rollbackErrors.Length > 0) throw new InvalidOperationException("Runtime installation failed; rollback also failed:" + rollbackErrors, installError);
                throw;
            }
        }

        private static string ExistingAssetsPath(string runtimePath)
        {
            string defaultPath = Directory.Exists(@"E:\") ? @"E:\Foart" : (Directory.Exists(@"D:\") ? @"D:\Foart" : @"C:\ProgramData\Foart");
            try
            {
                string config = Path.Combine(runtimePath, "runtime.json");
                if (!File.Exists(config)) return defaultPath;
                var serializer = new DataContractJsonSerializer(typeof(RuntimeAssetsInfo));
                RuntimeAssetsInfo info;
                using (FileStream input = File.OpenRead(config)) info = serializer.ReadObject(input) as RuntimeAssetsInfo;
                string value = info == null ? null : info.AssetsPath;
                if (String.IsNullOrWhiteSpace(value) || !Path.IsPathRooted(value)) return "";
                string normalized = value.Replace('/', '\\').TrimEnd('\\');
                string full = Path.GetFullPath(value);
                return String.Equals(normalized, full.TrimEnd('\\'), StringComparison.OrdinalIgnoreCase) ? full : "";
            }
            catch { return ""; }
        }

        private static RuntimeConfiguration ReadExistingRuntimeConfiguration(byte[] bytes)
        {
            if (bytes == null) return null;
            try
            {
                var serializer = new DataContractJsonSerializer(typeof(RuntimeConfiguration));
                using (var input = new MemoryStream(bytes))
                {
                    var result = serializer.ReadObject(input) as RuntimeConfiguration;
                    if (result == null) throw new InvalidDataException("Existing runtime.json is empty.");
                    if (result.Port.HasValue && (result.Port.Value < 1 || result.Port.Value > 65535))
                        throw new InvalidDataException("Existing runtime.json has an invalid port.");
                    if (!String.IsNullOrWhiteSpace(result.Engine) && result.Engine != "comfyui-core")
                        throw new InvalidDataException("Existing runtime.json uses another engine.");
                    return result;
                }
            }
            catch (InvalidDataException) { throw; }
            catch (Exception error) { throw new InvalidDataException("Existing runtime.json cannot be read safely.", error); }
        }

        private static string ValidatedRuntimePath(string value, string field)
        {
            if (String.IsNullOrWhiteSpace(value) || !Path.IsPathRooted(value))
                throw new InvalidDataException("Existing runtime.json has an invalid " + field + ".");
            string full = Path.GetFullPath(value);
            string root = Path.GetPathRoot(full);
            if (String.IsNullOrWhiteSpace(root) || root == "\\")
                throw new InvalidDataException("Existing runtime.json has an invalid " + field + ".");
            return full;
        }

        private static bool SameRuntimePath(string a, string b)
        {
            return String.Equals(Path.GetFullPath(a).TrimEnd('\\'), Path.GetFullPath(b).TrimEnd('\\'), StringComparison.OrdinalIgnoreCase);
        }

        private static byte[] BuildUpdatedRuntimeJson(RuntimeConfiguration config, string version, string installPath,
                                                       string assetsPath, string modelsPath, string customNodesPath)
        {
            if (String.IsNullOrWhiteSpace(config.Name)) config.Name = "NovaFlow AI Runtime";
            if (String.IsNullOrWhiteSpace(config.Engine)) config.Engine = "comfyui-core";
            if (!config.Port.HasValue) config.Port = 8188;
            config.Version = version;
            config.InstallPath = installPath;
            config.AssetsPath = assetsPath;
            config.ModelsPath = modelsPath;
            config.CustomNodesPath = customNodesPath;
            var serializer = new DataContractJsonSerializer(typeof(RuntimeConfiguration));
            using (var output = new MemoryStream())
            {
                serializer.WriteObject(output, config);
                return output.ToArray();
            }
        }

        private sealed class RuntimeScriptSnapshot
        {
            public string Path;
            public byte[] Before;
            public byte[] Copied;
            public byte[] Shim;
        }

        private static RuntimeScriptSnapshot[] CaptureRuntimeScripts(string runtimePath, string sourceRuntime)
        {
            string scriptDirectory = Path.Combine(runtimePath, "scripts");
            if (Directory.Exists(scriptDirectory) && (File.GetAttributes(scriptDirectory) & FileAttributes.ReparsePoint) != 0)
                throw new InvalidDataException("Runtime scripts directory is a link.");
            string[] names = { "start-runtime.bat", "stop-runtime.bat", "check-runtime.bat" };
            var snapshots = new RuntimeScriptSnapshot[names.Length * 2];
            for (int i = 0; i < names.Length; i++)
            {
                string relative = Path.Combine("scripts", names[i]);
                string script = Path.Combine(runtimePath, relative);
                string source = Path.Combine(sourceRuntime, relative);
                string shim = Path.Combine(runtimePath, names[i]);
                string sourceShim = Path.Combine(sourceRuntime, names[i]);
                foreach (string path in new[] { script, shim })
                    if (File.Exists(path) && (File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0)
                        throw new InvalidDataException("Runtime script is a link: " + path);
                snapshots[i] = new RuntimeScriptSnapshot { Path = script,
                    Before = File.Exists(script) ? File.ReadAllBytes(script) : null,
                    Copied = File.Exists(source) ? File.ReadAllBytes(source) : null };
                snapshots[i + names.Length] = new RuntimeScriptSnapshot { Path = shim,
                    Before = File.Exists(shim) ? File.ReadAllBytes(shim) : null,
                    Copied = File.Exists(sourceShim) ? File.ReadAllBytes(sourceShim) : null,
                    Shim = Encoding.ASCII.GetBytes(RuntimeScriptShimContent(names[i])) };
            }
            return snapshots;
        }

        private static bool SameBytes(byte[] a, byte[] b)
        {
            if (a == null || b == null || a.Length != b.Length) return false;
            for (int i = 0; i < a.Length; i++) if (a[i] != b[i]) return false;
            return true;
        }

        private static void RestoreRuntimeScript(RuntimeScriptSnapshot script)
        {
            byte[] current = File.Exists(script.Path) ? File.ReadAllBytes(script.Path) : null;
            if (SameBytes(current, script.Before) || (current == null && script.Before == null)) return;
            if (current != null && !SameBytes(current, script.Copied) && !SameBytes(current, script.Shim))
                throw new IOException("Script changed during installation; not overwritten.");
            if (script.Before == null)
            {
                if (current != null) File.Delete(script.Path);
            }
            else
            {
                Directory.CreateDirectory(Path.GetDirectoryName(script.Path));
                File.WriteAllBytes(script.Path, script.Before);
            }
        }

        private static string RuntimeScriptShimContent(string scriptName)
        {
            return string.Join(Environment.NewLine, new[]
            {
                "@echo off",
                "setlocal",
                "set \"SCRIPT_DIR=%~dp0\"",
                "call \"%SCRIPT_DIR%scripts\\" + scriptName + "\" %*",
                "exit /b %ERRORLEVEL%"
            }) + Environment.NewLine;
        }

        private static void WriteRuntimeScriptShim(string runtimePath, string scriptName)
        {
            File.WriteAllText(Path.Combine(runtimePath, scriptName), RuntimeScriptShimContent(scriptName), Encoding.ASCII);
        }

        private static void CopyDirectory(string sourceDirectory, string destinationDirectory, BackgroundWorker reporter, bool preserveQwenConfig = false)
        {
            Directory.CreateDirectory(destinationDirectory);
            reporter.ReportProgress(0, U("6B63", "5728", "590D", "5236", "0020", "Runtime", "0020", "6587", "4EF6", "002E", "002E", "002E"));

            var startInfo = new ProcessStartInfo();
            startInfo.FileName = "robocopy.exe";
            startInfo.Arguments = Quote(sourceDirectory) + " " + Quote(destinationDirectory) + " /E /R:2 /W:1 /NFL /NDL /NJH /NJS /NP" + (preserveQwenConfig ? " /XF qwen35-cpu.json" : "");
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
