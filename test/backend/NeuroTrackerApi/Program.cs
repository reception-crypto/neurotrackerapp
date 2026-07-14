using System.Globalization;
using System.Text;

var builder = WebApplication.CreateBuilder(args);
var app = builder.Build();

var dataDirectory = Path.Combine(AppContext.BaseDirectory, "Data");
Directory.CreateDirectory(dataDirectory);

var csvPath = Path.Combine(dataDirectory, "symptom_entries.csv");

if (!File.Exists(csvPath))
{
    await File.WriteAllTextAsync(
        csvPath,
        "Date,Time,PatientName,Disorder,Symptom1,Score1,Symptom2,Score2,Symptom3,Score3,BurdenScore\n",
        Encoding.UTF8);
}

app.MapGet("/", () => "NeuroTracker API is running.");

app.MapPost("/api/symptom-entry", async (SymptomEntry entry) =>
{
    if (string.IsNullOrWhiteSpace(entry.PatientName))
    {
        return Results.BadRequest("PatientName is required.");
    }

    var row = string.Join(",", new[]
    {
        Csv(entry.Date),
        Csv(entry.Time),
        Csv(entry.PatientName),
        Csv(entry.Disorder),
        Csv(entry.Symptom1),
        entry.Score1.ToString(CultureInfo.InvariantCulture),
        Csv(entry.Symptom2),
        entry.Score2.ToString(CultureInfo.InvariantCulture),
        Csv(entry.Symptom3),
        entry.Score3.ToString(CultureInfo.InvariantCulture),
        entry.BurdenScore.ToString(CultureInfo.InvariantCulture)
    });

    await File.AppendAllTextAsync(csvPath, row + "\n", Encoding.UTF8);
    return Results.Ok(new { saved = true });
});

app.MapGet("/api/symptom-entry/csv", async () =>
{
    var csv = await File.ReadAllTextAsync(csvPath, Encoding.UTF8);
    return Results.Text(csv, "text/csv", Encoding.UTF8);
});

app.Run();

static string Csv(string? value)
{
    value ??= string.Empty;
    var escaped = value.Replace("\"", "\"\"");
    return $"\"{escaped}\"";
}

public record SymptomEntry(
    string Date,
    string Time,
    string PatientName,
    string Disorder,
    string Symptom1,
    int Score1,
    string Symptom2,
    int Score2,
    string Symptom3,
    int Score3,
    int BurdenScore
);
