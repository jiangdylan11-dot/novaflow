using System;
using System.IO;
using NovaFlow.AiRuntimeSetup;

internal static class QwenComponentInstallerTests
{
    private static void Assert(bool value, string description) { if (!value) throw new Exception(description); }
    private static int Main(string[] args)
    {
        if (args.Length != 2 || Directory.Exists(args[0])) return 2;
        string runtime = Path.GetFullPath(args[0]), source = Path.GetFullPath(args[1]);
        string engine = Path.Combine(runtime, "engine"), comfy = Path.Combine(engine, "ComfyUI"), python = Path.Combine(engine, "python");
        Directory.CreateDirectory(comfy); Directory.CreateDirectory(python);
        File.WriteAllText(Path.Combine(comfy, "main.py"), "comfy-sentinel");
        File.WriteAllText(Path.Combine(python, "python.exe"), "python-sentinel");
        File.WriteAllText(Path.Combine(runtime, "qwen35-cpu.json"), "config-sentinel");
        string llama = Path.Combine(engine, "llama"), target = Path.Combine(llama, "ollama-v0.40.13");
        bool failed = false;
        try { QwenComponentInstaller.Install(runtime, source, () => { throw new InvalidOperationException("test-only staged failure"); }); }
        catch (InvalidOperationException) { failed = true; }
        Assert(failed && !Directory.Exists(target) && Directory.GetDirectories(llama).Length == 0, "stage failure did not roll back");
        QwenComponentInstaller.Install(runtime, source);
        Assert(File.Exists(Path.Combine(target, "lib", "ollama", "llama-server.exe")), "component not installed");
        QwenComponentInstaller.Install(runtime, source);
        Assert(File.ReadAllText(Path.Combine(comfy, "main.py")) == "comfy-sentinel" &&
               File.ReadAllText(Path.Combine(python, "python.exe")) == "python-sentinel" &&
               File.ReadAllText(Path.Combine(runtime, "qwen35-cpu.json")) == "config-sentinel", "existing runtime or config changed");
        File.WriteAllText(Path.Combine(target, "third-party-notices", "OLLAMA-MIT.txt"), "tampered fixture");
        failed = false;
        try { QwenComponentInstaller.Install(runtime, source); } catch (InvalidOperationException) { failed = true; }
        Assert(failed && File.ReadAllText(Path.Combine(target, "third-party-notices", "OLLAMA-MIT.txt")) == "tampered fixture", "conflicting target not protected");
        Console.WriteLine("PASS staged rollback, install, idempotence, preserved runtime/config and conflict protection");
        return 0;
    }
}
