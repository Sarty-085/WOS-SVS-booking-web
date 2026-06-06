import { Booking, Alliance, EventType } from '../types';
import { loadDailySlots } from '../dataStore';

/**
 * Creates a new, styled Google Spreadsheet with three tabs: Construction Day, Research Day, and Training Day.
 * Returns the spreadsheet ID on success.
 */
export async function createSpreadsheet(accessToken: string): Promise<string> {
  const payload = {
    properties: {
      title: "Royal Slots - State Event Registry"
    },
    sheets: [
      {
        properties: {
          title: "Construction Day",
          gridProperties: {
            rowCount: 100,
            columnCount: 15,
            frozenRowCount: 4
          }
        }
      },
      {
        properties: {
          title: "Research Day",
          gridProperties: {
            rowCount: 100,
            columnCount: 15,
            frozenRowCount: 4
          }
        }
      },
      {
        properties: {
          title: "Training Day",
          gridProperties: {
            rowCount: 100,
            columnCount: 15,
            frozenRowCount: 4
          }
        }
      }
    ]
  };

  const response = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Failed to create spreadsheet: ${errText}`);
  }

  const data = await response.json();
  return data.spreadsheetId;
}

/**
 * Syncs current bookings data to the Google Spreadsheet.
 * Clears old lines and inserts newly formatted grids into tomorrow's sheets.
 */
export async function syncSpreadsheetData(
  accessToken: string,
  spreadsheetId: string,
  bookings: Booking[],
  alliances: Alliance[]
): Promise<void> {
  const eventDays: { day: EventType; title: string; tab: string }[] = [
    { day: 'monday', title: 'CONSTRUCTION DAY - STATE EVENT CENTRAL REGISTRY', tab: 'Construction Day' },
    { day: 'tuesday', title: 'RESEARCH DAY - STATE EVENT CENTRAL REGISTRY', tab: 'Research Day' },
    { day: 'thursday', title: 'TRAINING DAY - STATE EVENT CENTRAL REGISTRY', tab: 'Training Day' }
  ];

  const updateRequests = [];

  for (const { day, title, tab } of eventDays) {
    // 1. Resolve live slot allocations for the day to match visual schedule
    const slots = loadDailySlots(day, bookings);
    
    // 2. Clear old cells first to avoid leftover rows
    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(tab)}!A1:Z100:clear`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });

    // 3. Construct beautiful and styled rows
    const rows: any[][] = [];

    // Styled Header Block
    rows.push([title]);
    rows.push(["LAST UPDATED TIMESTAMP (UTC)", new Date().toISOString(), "TOTAL ACTIVE SLOTS", slots.filter(s => s.status === 'booked').length]);
    rows.push([]); // spacer row

    // Table Column Headers
    rows.push([
      "Assigned Timeslot",
      "Status",
      "Username / Player Name",
      "User Identifier",
      "Alliance Block",
      "Speedup Days",
      "Speedup Hours",
      "Priority Score (DP)",
      "Backup Requests",
      "Auto-Assign Enabled"
    ]);

    // Feed in individual slots
    slots.forEach(slot => {
      if (slot.status === 'locked') {
        rows.push([
          slot.time,
          "LOCKED (System Calibration)",
          "-",
          "-",
          "-",
          "-",
          "-",
          "-",
          "-",
          "-"
        ]);
      } else if (slot.status === 'booked' && slot.bookingId) {
        const bk = bookings.find(b => b.id === slot.bookingId);
        if (bk) {
          const allianceObj = alliances.find(a => a.id === bk.allianceId);
          const allianceStr = allianceObj ? `${allianceObj.name} [${allianceObj.tag}]` : bk.allianceId;
          rows.push([
            slot.time,
            "BOOKED (Allotted)",
            bk.playerName,
            bk.userId,
            allianceStr,
            bk.speedupDays,
            bk.speedupHours,
            bk.score,
            bk.backupSlots.join(", ") || "None",
            bk.autoAssign ? "YES" : "NO"
          ]);
        } else {
          rows.push([slot.time, "BOOKED (Reference Missing)", "-", "-", "-", "-", "-", "-", "-", "-"]);
        }
      } else {
        rows.push([
          slot.time,
          "AVAILABLE (Open)",
          "-",
          "-",
          "-",
          "-",
          "-",
          "-",
          "-",
          "-"
        ]);
      }
    });

    updateRequests.push({
      range: `${tab}!A1`,
      values: rows
    });
  }

  // Execute batch update values
  const payload = {
    valueInputOption: "USER_ENTERED",
    data: updateRequests
  };

  const updateResponse = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!updateResponse.ok) {
    const errText = await updateResponse.text();
    throw new Error(`Failed to update spreadsheet cells: ${errText}`);
  }

  // Apply visual styling to the headers (make it beautiful)
  const formatPayload = {
    requests: [
      // Format Title Row for each Sheet (Large, Bold Text)
      ...[0, 1, 2].map(sheetIndex => ({
        repeatCell: {
          range: {
            sheetId: sheetIndex, // corresponding sheet ID (0, 1, 2)
            startRowIndex: 0,
            endRowIndex: 1,
            startColumnIndex: 0,
            endColumnIndex: 10
          },
          cell: {
            userEnteredFormat: {
              backgroundColor: { red: 0.05, green: 0.08, blue: 0.18 }, // deep dark slate
              textFormat: {
                foregroundColor: { red: 0.38, green: 0.84, blue: 0.95 }, // cyan-300
                fontSize: 14,
                bold: true
              },
              horizontalAlignment: "CENTER"
            }
          },
          fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)"
        }
      })),
      // Merge Title row cells across cols
      ...[0, 1, 2].map(sheetIndex => ({
        mergeCells: {
          range: {
            sheetId: sheetIndex,
            startRowIndex: 0,
            endRowIndex: 1,
            startColumnIndex: 0,
            endColumnIndex: 10
          },
          mergeType: "MERGE_ALL"
        }
      })),
      // Format Table Column Headers
      ...[0, 1, 2].map(sheetIndex => ({
        repeatCell: {
          range: {
            sheetId: sheetIndex,
            startRowIndex: 3,
            endRowIndex: 4,
            startColumnIndex: 0,
            endColumnIndex: 10
          },
          cell: {
            userEnteredFormat: {
              backgroundColor: { red: 0.1, green: 0.15, blue: 0.28 }, // dark indigo grey
              textFormat: {
                foregroundColor: { red: 1.0, green: 1.0, blue: 1.0 }, // white
                fontSize: 10,
                bold: true
              },
              horizontalAlignment: "LEFT"
            }
          },
          fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)"
        }
      }))
    ]
  };

  // We fetch custom metadata from Sheets API to convert index ids if sheetId is random.
  // Standard spreadsheets have index-based target sheet orders, but we can call batchUpdate safely on the sheet details.
  // Fetch Spreadsheet metadata first to extract real sheet IDs
  const metaResponse = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`, {
    headers: { 'Authorization': `Bearer ${accessToken}` }
  });
  if (metaResponse.ok) {
    const meta = await metaResponse.json();
    const sheetsList = meta.sheets || [];
    
    // Map requests with the ACTUAL sheet IDs
    const styledRequests = sheetsList.map((item: any, sheetIdx: number) => {
      const realId = item.properties.sheetId;
      return [
        {
          repeatCell: {
            range: {
              sheetId: realId,
              startRowIndex: 0,
              endRowIndex: 1,
              startColumnIndex: 0,
              endColumnIndex: 10
            },
            cell: {
              userEnteredFormat: {
                backgroundColor: { red: 0.05, green: 0.08, blue: 0.2 }, // deep dark cyan slate
                textFormat: {
                  foregroundColor: { red: 0.38, green: 0.84, blue: 0.95 }, // cyan
                  fontSize: 14,
                  bold: true
                },
                horizontalAlignment: 'CENTER'
              }
            },
            fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)"
          }
        },
        {
          mergeCells: {
            range: {
              sheetId: realId,
              startRowIndex: 0,
              endRowIndex: 1,
              startColumnIndex: 0,
              endColumnIndex: 10
            },
            mergeType: "MERGE_ALL"
          }
        },
        {
          repeatCell: {
            range: {
              sheetId: realId,
              startRowIndex: 3,
              endRowIndex: 4,
              startColumnIndex: 0,
              endColumnIndex: 10
            },
            cell: {
              userEnteredFormat: {
                backgroundColor: { red: 0.15, green: 0.15, blue: 0.15 }, // slate gray
                textFormat: {
                  foregroundColor: { red: 0.9, green: 0.9, blue: 0.9 }, // white
                  fontSize: 10,
                  bold: true
                },
                horizontalAlignment: "LEFT"
              }
            },
            fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)"
          }
        }
      ];
    }).flat();

    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
      method: "POST",
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ requests: styledRequests })
    });
  }
}
