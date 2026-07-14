# NeuroTracker backend — portal presentation update

## Run

```cmd
cd C:\Projects\neurotrackerapp\backend
npm install
copy .env.example .env
npm start
```

Patient review: `http://localhost:3000/admin`

Population analytics: `http://localhost:3000/admin/population`

## Portal changes

- Weekly aggregation is now the default.
- Fixed clinical axes: symptoms 0–10; wellness 0–100%.
- Cohort summary uses faint individual lines, a prominent mean, median and ±1 SD band.
- Patient overlay is limited to 10 selected patients.
- Australian date labels are shortened for legibility.
- Summary cards show reporting days, mean values, response status and cohort outliers.
- Patient PDF reports and CSV export are retained.

The backend continues to store submissions in `data\symptom_entries.csv`.
