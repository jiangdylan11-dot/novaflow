using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.Serialization;
using System.Runtime.Serialization.Json;
using System.Security.Cryptography;
using System.Text.RegularExpressions;

namespace NovaFlow.AiRuntimeSetup
{
    [DataContract]
    internal sealed class QwenInventory
    {
        [DataMember(Name = "schema")] public string Schema;
        [DataMember(Name = "component")] public string Component;
        [DataMember(Name = "target")] public string Target;
        [DataMember(Name = "includesModels")] public bool IncludesModels;
        [DataMember(Name = "files")] public QwenInventoryFile[] Files;
    }
    [DataContract]
    internal sealed class QwenInventoryFile
    {
        [DataMember(Name = "path")] public string Path;
        [DataMember(Name = "sha256")] public string Sha256;
        [DataMember(Name = "bytes")] public long Bytes;
        [DataMember(Name = "group")] public string Group;
    }
    [DataContract]
    internal sealed class QwenCudaInventory
    {
        [DataMember(Name = "schema")] public string Schema;
        [DataMember(Name = "component")] public string Component;
        [DataMember(Name = "target")] public string Target;
        [DataMember(Name = "includesModels")] public bool? IncludesModels;
        // Nullable booleans distinguish an explicit false from a missing field.
        [DataMember(Name = "redistributionApproved")] public bool? RedistributionApproved;
        [DataMember(Name = "gpuExecutionApproved")] public bool? GpuExecutionApproved;
        [DataMember(Name = "files")] public QwenInventoryFile[] Files;
    }
    [DataContract]
    internal sealed class QwenRunnerSelection
    {
        [DataMember(Name = "managedRunner")] public string ManagedRunner;
    }
    internal static class QwenComponentInstaller
    {
        private const string Component = "ollama-v0.40.13";
        private const string Inventory = "QWEN-RUNNER-INVENTORY.json";
        private const string InventoryHash = "b6f573fbd0a7487610b345e1b390f3629fb9d482f9c4a3ac651bca6f7c52d26e";
        private const string CudaComponent = "ollama-v0.40.13-cuda12";
        private const string CudaInventory = "QWEN-CUDA12-INVENTORY.json";
        private const string CudaInventoryHash = "a373ca561ed777def31d0e350ed75343b7f284edb1f0fa342480df2df389183c";
        private static readonly Dictionary<string, string> Notices = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase) {
            {"third-party-notices/OLLAMA-MIT.txt", "5934ed2ce0d15154bcdb9c85203210abac0da4314af34081e36df4599f90b226"},
            {"third-party-notices/LLVM-18.1.8-LICENSE.txt", "8d85c1057d742e597985c7d4e6320b015a9139385cff4cbae06ffc0ebe89afee"},
            {"third-party-notices/WINPTHREADS-COPYING.txt", "63263614cdd29f2f93cba85e992f041b31f9fc7b4033692f31269489a8a1b177"},
            {"third-party-notices/LLVM-MINGW-LICENSE.txt", "8e5db0129069005be2a07be3297e198888fd72fad62a13a611504660c6b7e3c7"}
        };
        private sealed class ExpectedFile { public string Hash; public long Bytes; }
        private static string HashFile(string path)
        {
            using (var hash = SHA256.Create()) using (var input = File.OpenRead(path))
                return BitConverter.ToString(hash.ComputeHash(input)).Replace("-", "").ToLowerInvariant();
        }
        private static void RealDirectory(string path)
        {
            if (!Directory.Exists(path) || (File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0)
                throw new InvalidOperationException("Directory missing or is a link: " + path);
        }
        private static void Walk(string root, string dir, HashSet<string> actual)
        {
            RealDirectory(dir);
            foreach (string child in Directory.GetFileSystemEntries(dir))
            {
                var attrs = File.GetAttributes(child);
                if ((attrs & FileAttributes.ReparsePoint) != 0) throw new InvalidOperationException("Component contains a link.");
                if ((attrs & FileAttributes.Directory) != 0) Walk(root, child, actual);
                else actual.Add(child.Substring(root.Length + 1).Replace('\\', '/'));
            }
        }
        private static Dictionary<string, ExpectedFile> Verify(string root)
        {
            root = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar);
            RealDirectory(root);
            string invPath = Path.Combine(root, Inventory);
            if (!File.Exists(invPath) || HashFile(invPath) != InventoryHash) throw new InvalidOperationException("Inventory hash mismatch.");
            QwenInventory data;
            using (var stream = File.OpenRead(invPath)) data = (QwenInventory)new DataContractJsonSerializer(typeof(QwenInventory)).ReadObject(stream);
            if (data == null || data.Schema != "nf.qwen-runner.official-inventory.v1" || data.Component != Component ||
                data.Target != "windows-x86_64" || data.IncludesModels || data.Files == null) throw new InvalidOperationException("Invalid inventory.");
            var expected = new Dictionary<string, ExpectedFile>(StringComparer.OrdinalIgnoreCase);
            expected.Add(Inventory, new ExpectedFile { Hash = InventoryHash });
            foreach (var entry in data.Files)
            {
                if (entry.Group != "cpu") continue;
                if (entry.Bytes <= 0 || !Regex.IsMatch(entry.Path ?? "", "^lib/ollama/[A-Za-z0-9._+-]+$") ||
                    !Regex.IsMatch(entry.Sha256 ?? "", "^[a-f0-9]{64}$") || expected.ContainsKey(entry.Path))
                    throw new InvalidOperationException("Invalid inventory entry.");
                expected.Add(entry.Path, new ExpectedFile { Hash = entry.Sha256, Bytes = entry.Bytes });
            }
            if (expected.Count != 30 || !expected.ContainsKey("lib/ollama/llama-server.exe")) throw new InvalidOperationException("Incomplete CPU inventory.");
            foreach (var item in Notices) expected.Add(item.Key, new ExpectedFile { Hash = item.Value });
            var actual = new HashSet<string>(StringComparer.OrdinalIgnoreCase); Walk(root, root, actual);
            if (actual.Count != expected.Count) throw new InvalidOperationException("Unexpected component file.");
            foreach (var pair in expected)
            {
                if (!actual.Contains(pair.Key)) throw new InvalidOperationException("Missing component file: " + pair.Key);
                string file = Path.Combine(root, pair.Key.Replace('/', Path.DirectorySeparatorChar));
                if ((pair.Value.Bytes > 0 && new FileInfo(file).Length != pair.Value.Bytes) || HashFile(file) != pair.Value.Hash)
                    throw new InvalidOperationException("Component file integrity failed: " + pair.Key);
            }
            return expected;
        }

        // CUDA is a separate sibling: do not alter or weaken the CPU bundle's
        // closed inventory. This is a local component installer only, not a
        // license or approval to redistribute the CUDA/VC binaries.
        private static Dictionary<string, ExpectedFile> VerifyCuda(string root, string externalInventory = null)
        {
            root = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar);
            RealDirectory(root);
            string invPath = externalInventory == null ? Path.Combine(root, CudaInventory) : Path.GetFullPath(externalInventory);
            if ((File.GetAttributes(invPath) & FileAttributes.ReparsePoint) != 0)
                throw new InvalidOperationException("CUDA inventory is a link.");
            if (!File.Exists(invPath) || HashFile(invPath) != CudaInventoryHash)
                throw new InvalidOperationException("CUDA inventory hash mismatch.");
            QwenCudaInventory data;
            using (var stream = File.OpenRead(invPath)) data = (QwenCudaInventory)new DataContractJsonSerializer(typeof(QwenCudaInventory)).ReadObject(stream);
            ValidateCudaMetadata(data);
            var expected = new Dictionary<string, ExpectedFile>(StringComparer.OrdinalIgnoreCase);
            if (externalInventory == null) expected.Add(CudaInventory, new ExpectedFile { Hash = CudaInventoryHash });
            foreach (var entry in data.Files)
            {
                if (entry.Bytes <= 0 || !Regex.IsMatch(entry.Path ?? "", "^[A-Za-z0-9._+-]+\\.dll$") ||
                    !Regex.IsMatch(entry.Sha256 ?? "", "^[a-f0-9]{64}$") || expected.ContainsKey(entry.Path))
                    throw new InvalidOperationException("Invalid CUDA inventory entry.");
                expected.Add(entry.Path, new ExpectedFile { Hash = entry.Sha256, Bytes = entry.Bytes });
            }
            if (expected.Count != (externalInventory == null ? 15 : 14) || !expected.ContainsKey("ggml-cuda.dll"))
                throw new InvalidOperationException("Incomplete CUDA inventory.");
            var actual = new HashSet<string>(StringComparer.OrdinalIgnoreCase); Walk(root, root, actual);
            if (actual.Count != expected.Count) throw new InvalidOperationException("Unexpected CUDA component file.");
            foreach (var pair in expected)
            {
                if (!actual.Contains(pair.Key)) throw new InvalidOperationException("Missing CUDA file: " + pair.Key);
                string file = Path.Combine(root, pair.Key);
                if ((pair.Value.Bytes > 0 && new FileInfo(file).Length != pair.Value.Bytes) || HashFile(file) != pair.Value.Hash)
                    throw new InvalidOperationException("CUDA component file integrity failed: " + pair.Key);
            }
            return expected;
        }

        private static void ValidateCudaMetadata(QwenCudaInventory data)
        {
            if (data == null || data.Schema != "nf.qwen-runner.cuda12-inventory.v1" || data.Component != CudaComponent ||
                data.Target != "windows-x86_64" || data.IncludesModels != false || data.RedistributionApproved != false ||
                data.GpuExecutionApproved != true || data.Files == null || data.Files.Length != 14)
                throw new InvalidOperationException("Invalid CUDA inventory.");
        }

        // Preserve only the exact verified component across a full engine
        // upgrade. Unknown versions and conflicting targets are refused.
        internal static void PreserveForUpgrade(string runtimeRoot, string previousEngine, bool engineMoved)
        {
            runtimeRoot = Path.GetFullPath(runtimeRoot).TrimEnd(Path.DirectorySeparatorChar);
            string engine = Path.Combine(runtimeRoot, "engine");
            RealDirectory(runtimeRoot);
            RealDirectory(engine);
            string config = Path.Combine(runtimeRoot, "qwen35-cpu.json");
            string selected = null;
            if (File.Exists(config))
            {
                if ((File.GetAttributes(config) & FileAttributes.ReparsePoint) != 0)
                    throw new InvalidOperationException("Qwen configuration is a link.");
                using (var input = File.OpenRead(config))
                {
                    var selection = new DataContractJsonSerializer(typeof(QwenRunnerSelection)).ReadObject(input) as QwenRunnerSelection;
                    if (selection == null) throw new InvalidOperationException("Invalid Qwen configuration.");
                    selected = selection.ManagedRunner;
                }
                if (!String.IsNullOrEmpty(selected) && !String.Equals(selected, Component, StringComparison.Ordinal))
                    throw new InvalidOperationException("Unknown managed Qwen component version.");
            }

            string newLlama = Path.Combine(engine, "llama");
            if (Directory.Exists(newLlama)) RealDirectory(newLlama);
            else if (File.Exists(newLlama)) throw new InvalidOperationException("Qwen component directory conflicts with a file.");
            string target = Path.Combine(newLlama, Component);
            if (File.Exists(target)) throw new InvalidOperationException("Qwen component target conflicts with a file.");
            bool newExists = Directory.Exists(target);
            if (newExists) Verify(target);

            string oldComponent = null;
            if (engineMoved)
            {
                previousEngine = Path.GetFullPath(previousEngine).TrimEnd(Path.DirectorySeparatorChar);
                if (!String.Equals(previousEngine, Path.Combine(runtimeRoot, "engine.previous"), StringComparison.OrdinalIgnoreCase))
                    throw new InvalidOperationException("Unexpected previous engine location.");
                RealDirectory(previousEngine);
                string oldLlama = Path.Combine(previousEngine, "llama");
                if (Directory.Exists(oldLlama))
                {
                    RealDirectory(oldLlama);
                    oldComponent = Path.Combine(oldLlama, Component);
                    if (File.Exists(oldComponent)) throw new InvalidOperationException("Previous Qwen component conflicts with a file.");
                    if (!Directory.Exists(oldComponent)) oldComponent = null;
                    else Verify(oldComponent);
                }
                else if (File.Exists(oldLlama)) throw new InvalidOperationException("Previous Qwen component directory conflicts with a file.");
            }
            if (oldComponent != null && !newExists)
            {
                Install(runtimeRoot, oldComponent);
                newExists = true;
            }
            if (!String.IsNullOrEmpty(selected) && !newExists)
                throw new InvalidOperationException("Selected managed Qwen component is missing.");

            // A full engine replacement must preserve an already installed,
            // verified GPU companion just as it preserves its CPU runner.
            string cudaTarget = Path.Combine(newLlama, CudaComponent);
            if (File.Exists(cudaTarget)) throw new InvalidOperationException("CUDA target conflicts with a file.");
            if (Directory.Exists(cudaTarget)) VerifyCuda(cudaTarget);
            if (engineMoved)
            {
                string oldCuda = Path.Combine(previousEngine, "llama", CudaComponent);
                if (File.Exists(oldCuda)) throw new InvalidOperationException("Previous CUDA component conflicts with a file.");
                if (Directory.Exists(oldCuda))
                {
                    VerifyCuda(oldCuda);
                    if (!Directory.Exists(cudaTarget)) InstallCuda(runtimeRoot, oldCuda);
                }
            }
        }

        internal static void InstallCuda(string runtimeRoot, string componentRoot, string externalInventory = null, Action stagedTestHook = null)
        {
            runtimeRoot = Path.GetFullPath(runtimeRoot).TrimEnd(Path.DirectorySeparatorChar);
            componentRoot = Path.GetFullPath(componentRoot).TrimEnd(Path.DirectorySeparatorChar);
            RealDirectory(runtimeRoot);
            string engine = Path.Combine(runtimeRoot, "engine"); RealDirectory(engine);
            if (!File.Exists(Path.Combine(engine, "ComfyUI", "main.py")) || !File.Exists(Path.Combine(engine, "python", "python.exe")))
                throw new InvalidOperationException("The target is not an existing Foart runtime.");
            string llama = Path.Combine(engine, "llama"); RealDirectory(llama);
            Verify(Path.Combine(llama, Component));
            var files = VerifyCuda(componentRoot, externalInventory);
            string target = Path.Combine(llama, CudaComponent);
            if (Directory.Exists(target)) { VerifyCuda(target); return; }
            if (File.Exists(target)) throw new InvalidOperationException("CUDA target exists and is not a directory.");
            StageCudaComponent(componentRoot, target, externalInventory, files.Keys,
                stagePath => { VerifyCuda(stagePath); }, stagedTestHook);
        }

        // Keep the exact same-volume staging/rename path testable with tiny
        // synthetic fixtures. Production supplies only the fixed inventory
        // above and always performs the real cryptographic stage verification.
        private static void StageCudaComponent(string componentRoot, string target, string externalInventory,
            IEnumerable<string> files, Action<string> verifyStage, Action stagedTestHook)
        {
            string llama = Path.GetDirectoryName(target);
            string stage = Path.Combine(llama, "." + CudaComponent + ".stage-" + Guid.NewGuid().ToString("N"));
            try
            {
                Directory.CreateDirectory(stage);
                foreach (var file in files) File.Copy(Path.Combine(componentRoot, file), Path.Combine(stage, file), false);
                if (externalInventory != null) File.Copy(Path.GetFullPath(externalInventory), Path.Combine(stage, CudaInventory), false);
                verifyStage(stage);
                if (stagedTestHook != null) stagedTestHook();
                Directory.Move(stage, target);
            }
            finally { if (Directory.Exists(stage)) Directory.Delete(stage, true); }
        }
        internal static void Install(string runtimeRoot, string componentRoot, Action stagedTestHook = null)
        {
            runtimeRoot = Path.GetFullPath(runtimeRoot).TrimEnd(Path.DirectorySeparatorChar);
            componentRoot = Path.GetFullPath(componentRoot).TrimEnd(Path.DirectorySeparatorChar);
            RealDirectory(runtimeRoot);
            string engine = Path.Combine(runtimeRoot, "engine"); RealDirectory(engine);
            if (!File.Exists(Path.Combine(engine, "ComfyUI", "main.py")) || !File.Exists(Path.Combine(engine, "python", "python.exe")))
                throw new InvalidOperationException("The target is not an existing Foart runtime.");
            var files = Verify(componentRoot);
            string llama = Path.Combine(engine, "llama");
            if (!Directory.Exists(llama)) Directory.CreateDirectory(llama);
            RealDirectory(llama);
            string target = Path.Combine(llama, Component);
            if (Directory.Exists(target)) { Verify(target); return; }
            if (File.Exists(target)) throw new InvalidOperationException("Component target exists and is not a directory.");
            string stage = Path.Combine(llama, "." + Component + ".stage-" + Guid.NewGuid().ToString("N"));
            try
            {
                Directory.CreateDirectory(stage);
                foreach (var pair in files)
                {
                    string from = Path.Combine(componentRoot, pair.Key.Replace('/', Path.DirectorySeparatorChar));
                    string to = Path.Combine(stage, pair.Key.Replace('/', Path.DirectorySeparatorChar));
                    Directory.CreateDirectory(Path.GetDirectoryName(to)); File.Copy(from, to, false);
                }
                Verify(stage);
                if (stagedTestHook != null) stagedTestHook();
                Directory.Move(stage, target);
            }
            finally { if (Directory.Exists(stage)) Directory.Delete(stage, true); }
        }
    }
}
