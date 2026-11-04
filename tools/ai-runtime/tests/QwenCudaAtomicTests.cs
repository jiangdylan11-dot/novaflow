using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using NovaFlow.AiRuntimeSetup;

// Exercises the real same-volume staging and rename with disposable tiny
// fixtures. The production verifier remains pinned to the 14 real DLL hashes.
internal static class QwenCudaAtomicTests
{
    private const string StagePrefix = ".ollama-v0.40.13-cuda12.stage-";
    private static int assertions;
    private static void Check(bool condition, string message)
    {
        if (!condition) throw new Exception(message);
        assertions++;
    }
    private static void Stage(string source, string target, Action<string> verify, Action hook, string inventory = null)
    {
        try
        {
            typeof(QwenComponentInstaller).GetMethod("StageCudaComponent", BindingFlags.Static | BindingFlags.NonPublic)
                .Invoke(null, new object[] { source, target, inventory, new List<string> { "mock.dll" }, verify, hook });
        }
        catch (TargetInvocationException e) { throw e.InnerException; }
    }
    private static void NoStages(string root)
    {
        Check(Directory.GetDirectories(root, StagePrefix + "*").Length == 0, "staging residue remains");
    }
    private static int Main(string[] args)
    {
        string baseDir = args.Length == 1 ? Path.GetFullPath(args[0]) : Path.GetTempPath();
        string root = Path.Combine(baseDir, "foart-cuda-atomic-" + Guid.NewGuid().ToString("N"));
        string source = Path.Combine(root, "source");
        Directory.CreateDirectory(source);
        File.WriteAllText(Path.Combine(source, "mock.dll"), "trusted fixture");
        Action<string> verify = stage => {
            if (File.ReadAllText(Path.Combine(stage, "mock.dll")) != "trusted fixture")
                throw new InvalidOperationException("stage verification failed");
        };
        try
        {
            string success = Path.Combine(root, "success");
            Stage(source, success, verify, null);
            Check(File.ReadAllText(Path.Combine(success, "mock.dll")) == "trusted fixture", "successful target mismatch");
            Check(File.Exists(Path.Combine(source, "mock.dll")), "source was changed");
            NoStages(root);

            string externalInventory = Path.Combine(root, "inventory.json");
            File.WriteAllText(externalInventory, "pinned fixture inventory");
            string withInventory = Path.Combine(root, "with-inventory");
            Stage(source, withInventory, stage => {
                verify(stage);
                if (File.ReadAllText(Path.Combine(stage, "QWEN-CUDA12-INVENTORY.json")) != "pinned fixture inventory")
                    throw new InvalidOperationException("inventory missing from stage");
            }, null, externalInventory);
            Check(File.Exists(Path.Combine(withInventory, "QWEN-CUDA12-INVENTORY.json")), "inventory was not committed");
            Check(File.Exists(externalInventory), "external inventory source was changed");
            NoStages(root);

            string interrupted = Path.Combine(root, "interrupted");
            bool failed = false;
            try { Stage(source, interrupted, verify, () => { throw new InvalidOperationException("injected failure"); }); }
            catch (InvalidOperationException) { failed = true; }
            Check(failed && !Directory.Exists(interrupted), "injected failure committed target");
            NoStages(root);

            string badStage = Path.Combine(root, "bad-stage");
            failed = false;
            try { Stage(source, badStage, s => { throw new InvalidOperationException("bad stage"); }, null); }
            catch (InvalidOperationException) { failed = true; }
            Check(failed && !Directory.Exists(badStage), "invalid stage committed target");
            NoStages(root);

            string conflict = Path.Combine(root, "conflict");
            failed = false;
            try { Stage(source, conflict, verify, () => { Directory.CreateDirectory(conflict); File.WriteAllText(Path.Combine(conflict, "keep.txt"), "preserve"); }); }
            catch (IOException) { failed = true; }
            Check(failed && File.ReadAllText(Path.Combine(conflict, "keep.txt")) == "preserve", "conflicting target was replaced");
            Check(!File.Exists(Path.Combine(conflict, "mock.dll")), "staged files leaked into conflicting target");
            NoStages(root);
            Console.WriteLine("PASS " + assertions + " assertions: commit, source preservation, interrupted/invalid stage cleanup and target conflict");
            return 0;
        }
        catch (Exception e) { Console.Error.WriteLine(e.GetType().Name + ": " + e.Message); return 1; }
        finally { Directory.Delete(root, true); }
    }
}
