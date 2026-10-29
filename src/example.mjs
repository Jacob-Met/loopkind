export const threePersonExample = {
  "version": 1,
  "title": "Saturday at Juniper Court",
  "date": "2026-10-31",
  "utcOffset": "-07:00",
  "skills": [
    {
      "id": "mending",
      "label": "Clothing mending"
    },
    {
      "id": "plant-care",
      "label": "Plant care"
    },
    {
      "id": "spreadsheets",
      "label": "Spreadsheet help"
    }
  ],
  "members": [
    {
      "id": "mara",
      "name": "Mara",
      "active": true,
      "offer": "mending",
      "need": "plant-care",
      "durationMinutes": 45,
      "windows": [
        {
          "start": 540,
          "end": 660
        }
      ],
      "afterReceive": true,
      "materialsReady": true,
      "confirmed": true,
      "notes": "I can mend a loose seam. I need help repotting two herbs."
    },
    {
      "id": "theo",
      "name": "Theo",
      "active": true,
      "offer": "plant-care",
      "need": "spreadsheets",
      "durationMinutes": 30,
      "windows": [
        {
          "start": 540,
          "end": 690
        }
      ],
      "afterReceive": false,
      "materialsReady": true,
      "confirmed": true,
      "notes": "I can help with your plants. I need a simple spending spreadsheet."
    },
    {
      "id": "jules",
      "name": "Jules",
      "active": true,
      "offer": "spreadsheets",
      "need": "mending",
      "durationMinutes": 30,
      "windows": [
        {
          "start": 570,
          "end": 690
        }
      ],
      "afterReceive": true,
      "materialsReady": true,
      "confirmed": true,
      "notes": "I can tidy a spreadsheet. I need a jacket pocket repaired."
    }
  ]
};
export const fourPersonExample = {
  "version": 1,
  "title": "Four neighbours, one useful morning",
  "date": "2026-10-31",
  "utcOffset": "-07:00",
  "skills": [
    {
      "id": "mending",
      "label": "Clothing mending"
    },
    {
      "id": "plant-care",
      "label": "Plant care"
    },
    {
      "id": "spreadsheets",
      "label": "Spreadsheet help"
    },
    {
      "id": "label-design",
      "label": "Label design"
    }
  ],
  "members": [
    {
      "id": "mara",
      "name": "Mara",
      "active": true,
      "offer": "mending",
      "need": "plant-care",
      "durationMinutes": 30,
      "windows": [
        {
          "start": 540,
          "end": 600
        }
      ],
      "afterReceive": false,
      "materialsReady": true,
      "confirmed": true,
      "notes": "I can mend a loose seam. I need help repotting two herbs."
    },
    {
      "id": "theo",
      "name": "Theo",
      "active": true,
      "offer": "plant-care",
      "need": "label-design",
      "durationMinutes": 30,
      "windows": [
        {
          "start": 540,
          "end": 600
        }
      ],
      "afterReceive": false,
      "materialsReady": true,
      "confirmed": true,
      "notes": "I can help with your plants. I need a simple spending spreadsheet."
    },
    {
      "id": "jules",
      "name": "Jules",
      "active": true,
      "offer": "spreadsheets",
      "need": "mending",
      "durationMinutes": 30,
      "windows": [
        {
          "start": 540,
          "end": 600
        }
      ],
      "afterReceive": false,
      "materialsReady": true,
      "confirmed": true,
      "notes": "I can tidy a spreadsheet. I need a jacket pocket repaired."
    },
    {
      "id": "nia",
      "name": "Nia",
      "active": true,
      "offer": "label-design",
      "need": "spreadsheets",
      "durationMinutes": 30,
      "windows": [
        {
          "start": 540,
          "end": 600
        }
      ],
      "afterReceive": false,
      "materialsReady": true,
      "confirmed": true,
      "notes": "I can design simple labels for your plant pots. I need a sheet for tracking shared supplies."
    }
  ]
};
export function exampleProject(scenario='three') { const project=structuredClone(scenario==='four'?fourPersonExample:threePersonExample); if(scenario==='circular') project.members.find(m=>m.id==='theo').afterReceive=true; if(scenario==='tight') project.members.find(m=>m.id==='mara').windows=[{start:540,end:600}]; return project; }
