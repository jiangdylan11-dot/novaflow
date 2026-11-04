using System;
using System.IO;
using NovaFlow.AiRuntimeSetup;

// Uses a caller-supplied, already existing CPU component only as a read-only
// source. All mutations occur in an isolated directory created by this test.
internal static class QwenCpuPreserveTests
{
    private static int assertions;
    private static void Check(bool condition, string message)
    {
        if (!condition) throw new Exception(message);
        assertions++;
    }
    private static void CopyTree(string source, string target)
    {
        Directory.CreateDirectory(target);
        foreach (string file in Directory.GetFiles(source))
            File.Copy(file, Path.Combine(target, Path.GetFileName(file)), false);
        foreach (string directory in Directory.GetDirectories(source))
            CopyTree(directory, Path.Combine(target, Path.GetFileName(directory)));
    }
    private static int Main(string[] args)
    {
        if (args.Length != 2) return 2;
        string root = Path.Combine(Path.GetFullPath(args[1]), "foart-cpu-preserve-" + Guid.NewGuid().ToString("N"));
        string previous = Path.Combine(root, "engine.previous");
        string oldCpu = Path.Combine(previous, "llama", "ollama-v0.40.13");
        string engine = Path.Combine(root, "engine");
        string newCpu = Path.Combine(engine, "llama", "ollama-v0.40.13");
        string config = Path.Combine(root, "qwen35-cpu.json");
        try
        {
            CopyTree(Path.GetFullPath(args[0]), oldCpu);
            Directory.CreateDirectory(Path.Combine(engine, "ComfyUI"));
            Directory.CreateDirectory(Path.Combine(engine, "python"));
            File.WriteAllText(Path.Combine(engine, "ComfyUI", "main.py"), "fixture");
            File.WriteAllText(Path.Combine(engine, "python", "python.exe"), "fixture");
            const string fixtureConfig = "{\"managedRunner\":\"ollama-v0.40.13\",\"custom\":\"unchanged\"}";
            File.WriteAllText(config, fixtureConfig);

            QwenComponentInstaller.PreserveForUpgrade(root, previous, true);
            Check(File.Exists(Path.Combine(newCpu, "lib", "ollama", "llama-server.exe")), "old CPU component was not preserved");
            Check(File.Exists(Path.Combine(oldCpu, "lib", "ollama", "llama-server.exe")), "old CPU component was removed");
            Check(File.ReadAllText(config) == fixtureConfig, "user configuration changed");
            Check(Directory.GetDirectories(Path.Combine(engine, "llama"), ".*.stage-*").Length == 0, "staging residue remains");

            QwenComponentInstaller.PreserveForUpgrade(root, previous, true);
            Check(File.ReadAllText(config) == fixtureConfig, "repeat upgrade changed config");
            string exe = Path.Combine(oldCpu, "lib", "ollama", "llama-server.exe");
            byte[] original = File.ReadAllBytes(exe);
            File.AppendAllText(exe, "tampered");
            bool rejected = false;
            try { QwenComponentInstaller.PreserveForUpgrade(root, previous, true); }
            catch (InvalidOperationException) { rejected = true; }
            Check(rejected, "tampered old CPU component was accepted");
            Check(File.Exists(Path.Combine(newCpu, "lib", "ollama", "llama-server.exe")), "valid current CPU component was removed");
            File.WriteAllBytes(exe, original);
            Console.WriteLine("PASS " + assertions + " assertions: CPU preservation, source/config unchanged, repeat and corrupt source rejection");
            return 0;
        }
        catch (Exception e) { Console.Error.WriteLine(e.GetType().Name + ": " + e.Message); return 1; }
        finally { if (Directory.Exists(root)) Directory.Delete(root, true); }
    }
}
