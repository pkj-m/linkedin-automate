# LinkedIn Automate

A Chrome extension to automate LinkedIn connection requests from a list of profile URLs with personalized messages.

<img width="392" height="595" alt="image" src="https://github.com/user-attachments/assets/9c7f67fe-cd1f-443d-9d6b-eaa4cab41870" />


## Features

- Read LinkedIn profile URLs from a Google Sheet
- Send personalized connection requests with custom messages
- Support for message placeholders: `{firstName}`, `{lastName}`, `{fullName}`
- Automatic detection of profile status (Pending, Already Connected, Follow Only)
- Export results to CSV when complete
- Configurable delay between requests to avoid rate limiting

## Installation

### From Source (Developer Mode)

1. Clone this repository:
   ```bash
   git clone https://github.com/pkj-m/linkedin-automate.git
   ```

2. Open Chrome and navigate to `chrome://extensions/`

3. Enable "Developer mode" (toggle in top right)

4. Click "Load unpacked"

5. Select the `linkedin-automate` folder

## Setup

### 1. Create a Google Cloud API Key

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or select existing)
3. Enable the **Google Sheets API**:
   - Go to "APIs & Services" > "Library"
   - Search for "Google Sheets API"
   - Click Enable
4. Create credentials:
   - Go to "APIs & Services" > "Credentials"
   - Click "Create Credentials" > "API Key"
   - Copy the API key

### 2. Prepare Your Google Sheet

Create a Google Sheet with LinkedIn profile URLs in column A:

| Column A (LinkedIn URL) |
|------------------------|
| https://linkedin.com/in/johndoe |
| https://linkedin.com/in/janedoe |

**Important:** Make the sheet publicly viewable:
1. Click "Share" button
2. Change to "Anyone with the link can view"

This is required for reading with an API key.

## Usage

1. Click the extension icon in Chrome toolbar
2. Enter your configuration:
   - **Google Sheet ID**: Found in the sheet URL `docs.google.com/spreadsheets/d/[SHEET_ID]/edit`
   - **API Key**: Your Google Cloud API key
   - **Sheet Range**: Default is `Sheet1!A2:A` (URLs in column A starting row 2)
   - **Message Template**: Your connection message with placeholders
3. Click "Start Sending"
4. When complete, click "Export CSV" to download results

### Message Placeholders

- `{firstName}` - Person's first name
- `{lastName}` - Person's last name
- `{fullName}` - Person's full name

### Example Message

```
Hi {firstName},

I came across your profile and would love to connect. Looking forward to staying in touch!

Best regards
```

## Output

When the automation completes, export your results to CSV. The CSV includes:

| Column | Description |
|--------|-------------|
| Row | Original row number from sheet |
| URL | LinkedIn profile URL |
| Status | Result (Sent, Pending, Already Connected, Follow Only, Failed) |
| Timestamp | When the action was taken |

## Important Notes

### Rate Limiting
- Default delay is 10 seconds between profiles
- LinkedIn may flag your account if you send too many requests too quickly
- **Recommended: 20-50 connections per day maximum**

### Limitations
- LinkedIn's DOM structure changes periodically; selectors may need updates
- Some profiles have "Follow" instead of "Connect"
- Profiles with pending requests or existing connections are automatically skipped

## Troubleshooting

### "Content script not responding"
- Make sure you're on a LinkedIn profile page
- Try refreshing the page
- Reload the extension

### "Could not find Connect button"
- The person may only allow "Follow"
- You may already be connected or have a pending request
- LinkedIn may have changed their button layout

### API Key Errors
- Make sure Google Sheets API is enabled
- Check that the sheet is publicly viewable
- Verify the API key has no restrictions blocking sheets.googleapis.com

## Project Structure

```
linkedin-automate/
├── manifest.json      # Extension configuration
├── background.js      # Service worker - orchestrates the workflow
├── content.js         # Content script - interacts with LinkedIn pages
├── popup.html         # Extension popup UI
├── popup.js           # Popup logic
├── icons/             # Extension icons
├── LICENSE            # MIT License
└── README.md          # This file
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Disclaimer

**Use this tool responsibly.** Automated actions on LinkedIn may violate their [Terms of Service](https://www.linkedin.com/legal/user-agreement). Use at your own risk.

- Keep connection volumes low (20-50 per day)
- Write genuine, personalized messages
- Respect people's time and privacy

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
