using System;
using System.IO;
using System.Reflection;
using System.Runtime.Serialization.Json;
using NovaFlow.AiRuntimeSetup;

// Compiled together with QwenComponentInstaller.cs. Verification is read-only:
// no installer method is called and no runtime directory is changed.
internal static class QwenCudaInventoryTests
{
    private static object Verify(string root, string inventory)
    {
        try {
            return typeof(QwenComponentInstaller).GetMethod("VerifyCuda", BindingFlags.Static | BindingFlags.NonPublic)
                .Invoke(null, new object[] { root, inventory });
        } catch (TargetInvocationException e) { throw e.InnerException; }
    }
    private static void Metadata(QwenCudaInventory data)
    {
        try {
            typeof(QwenComponentInstaller).GetMethod("ValidateCudaMetadata", BindingFlags.Static | BindingFlags.NonPublic)
                .Invoke(null, new object[] { data });
        } catch (TargetInvocationException e) { throw e.InnerException; }
    }
    private static void Reject(QwenCudaInventory data, string reason)
    {
        bool rejected = false;
        try { Metadata(data); } catch (InvalidOperationException) { rejected = true; }
        if (!rejected) throw new Exception("Invalid metadata accepted: " + reason);
    }
    private static int Main(string[] args)
    {
        if (args.Length != 2) return 2;
        string tmp = Path.Combine(Path.GetTempPath(), "foart-cuda-inventory-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(tmp);
        try {
            Verify(args[0], args[1]);
            QwenCudaInventory metadata;
            using (var input = File.OpenRead(args[1]))
                metadata = (QwenCudaInventory)new DataContractJsonSerializer(typeof(QwenCudaInventory)).ReadObject(input);
            Metadata(metadata);
            metadata.GpuExecutionApproved = null; Reject(metadata, "missing execution permission");
            metadata.GpuExecutionApproved = false; Reject(metadata, "execution disabled");
            metadata.GpuExecutionApproved = true;
            metadata.RedistributionApproved = null; Reject(metadata, "missing redistribution restriction");
            metadata.RedistributionApproved = true; Reject(metadata, "redistribution allowed");
            metadata.RedistributionApproved = false;
            metadata.IncludesModels = null; Reject(metadata, "missing model exclusion");
            metadata.IncludesModels = true; Reject(metadata, "model included");
            metadata.IncludesModels = false;
            metadata.Files = null; Reject(metadata, "missing file list");
            string bad = Path.Combine(tmp, "bad-inventory.json");
            File.WriteAllText(bad, "{}");
            bool rejectedBad = false, rejectedMissing = false;
            try { Verify(args[0], bad); } catch (InvalidOperationException) { rejectedBad = true; }
            try { Verify(tmp, args[1]); } catch (InvalidOperationException) { rejectedMissing = true; }
            if (!rejectedBad || !rejectedMissing) throw new Exception("Negative integrity check was accepted.");
            Console.WriteLine("PASS upstream 14-file inventory; reject 7 invalid metadata states, unpinned inventory and missing files");
            return 0;
        } catch (Exception e) { Console.Error.WriteLine(e.GetType().Name + ": " + e.Message); return 1; }
        finally { Directory.Delete(tmp, true); }
    }
}
