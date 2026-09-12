using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

internal static class ForegroundContext
{
    private const uint GW_HWNDNEXT = 2;

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern IntPtr GetWindow(IntPtr window, uint command);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr window);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr window, StringBuilder text, int maximum);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);

    private static string Escape(string value)
    {
        var result = new StringBuilder(value.Length + 8);
        foreach (char character in value)
        {
            switch (character)
            {
                case '\\': result.Append("\\\\"); break;
                case '"': result.Append("\\\""); break;
                case '\b': result.Append("\\b"); break;
                case '\f': result.Append("\\f"); break;
                case '\n': result.Append("\\n"); break;
                case '\r': result.Append("\\r"); break;
                case '\t': result.Append("\\t"); break;
                default:
                    if (character < 32) result.AppendFormat("\\u{0:x4}", (int)character);
                    else result.Append(character);
                    break;
            }
        }
        return result.ToString();
    }

    private static string Identity(Process process)
    {
        return process.ProcessName + ".exe";
    }

    private static bool TryDescribe(
        IntPtr window,
        IDictionary<string, string> supported,
        out string identity,
        out string name,
        out string title,
        out int processId)
    {
        identity = name = title = "";
        processId = 0;
        if (window == IntPtr.Zero || !IsWindowVisible(window)) return false;
        uint rawProcessId;
        GetWindowThreadProcessId(window, out rawProcessId);
        processId = unchecked((int)rawProcessId);
        try
        {
            using (var process = Process.GetProcessById(processId))
            {
                string executable = Identity(process);
                string configured;
                identity = supported.TryGetValue(executable, out configured) ? configured : executable;
                name = process.ProcessName;
            }
        }
        catch
        {
            return false;
        }
        var text = new StringBuilder(32768);
        GetWindowText(window, text, text.Capacity);
        title = text.ToString();
        return true;
    }

    public static int Main(string[] args)
    {
        Console.OutputEncoding = new UTF8Encoding(false);
        int parentProcessId;
        if (args.Length < 1 || !Int32.TryParse(args[0], out parentProcessId)) return 2;
        var supported = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        for (int index = 1; index < args.Length; index++) supported[args[index]] = args[index];

        IntPtr selected = GetForegroundWindow();
        string identity, name, title;
        int selectedProcessId;
        if (!TryDescribe(selected, supported, out identity, out name, out title, out selectedProcessId)) return 3;

        // Clicking Worket's panel makes Worket foreground. Walk the native Z-order
        // to recover the nearest supported work window beneath it.
        if (selectedProcessId == parentProcessId)
        {
            for (IntPtr candidate = GetWindow(selected, GW_HWNDNEXT);
                 candidate != IntPtr.Zero;
                 candidate = GetWindow(candidate, GW_HWNDNEXT))
            {
                string candidateIdentity, candidateName, candidateTitle;
                int candidateProcessId;
                if (!TryDescribe(candidate, supported, out candidateIdentity, out candidateName, out candidateTitle, out candidateProcessId)) continue;
                if (!supported.ContainsKey(candidateIdentity)) continue;
                identity = candidateIdentity;
                name = candidateName;
                title = candidateTitle;
                break;
            }
        }

        Console.WriteLine("{\"bundleId\":\"" + Escape(identity) + "\",\"name\":\"" +
            Escape(name) + "\",\"windowTitle\":\"" + Escape(title) + "\"}");
        return 0;
    }
}
