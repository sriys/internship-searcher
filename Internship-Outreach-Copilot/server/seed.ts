import { storage } from "./storage";
import * as xlsx from "xlsx";
import * as fs from "fs";
import * as path from "path";

async function importXlsx(filePath: string) {
  try {
    if (!fs.existsSync(filePath)) {
      console.log(`File not found: ${filePath}`);
      return;
    }

    const buffer = fs.readFileSync(filePath);
    const workbook = xlsx.read(buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = xlsx.utils.sheet_to_json(worksheet) as any[];

    console.log(`Importing ${data.length} rows from ${filePath}`);

    for (const row of data) {
      // Common headers mapping
      const name = row.Company || row.name || row.Name || row["Company Name"];
      const url = row.Website || row.url || row.URL || row.Link;
      const track = row.Track || row.track || row.Category || "general";
      const size = row.Size || row.size || "unknown";
      
      const contactName = row.Contact || row["Contact Name"] || row.Name;
      const email = row.Email || row["Contact Email"];
      const position = row.Position || row.Role || row.Title;

      if (name && url) {
        try {
          const company = await storage.createCompany({
            name: String(name),
            url: String(url).startsWith("http") ? String(url) : `https://${url}`,
            track: String(track).toLowerCase(),
            size: String(size).toLowerCase(),
          });

          if (contactName) {
            await storage.createContact({
              companyId: company.id,
              name: String(contactName),
              email: email ? String(email) : null,
              position: position ? String(position) : null,
              active: true,
            });
          }
        } catch (e) {
          // Likely duplicate URL, skip
        }
      }
    }
  } catch (error) {
    console.error(`Failed to import ${filePath}:`, error);
  }
}

export async function seedDatabase() {
  const existingCompanies = await storage.getCompanies();
  if (existingCompanies.length <= 1) { // 1 is the default Replit seed
    const files = [
      "attached_assets/Internship_(1)_1771028496305.xlsx",
      "attached_assets/Internship_Hunt_(1)_1771028496305.xlsx",
      "attached_assets/Internship_(1)_1771028896356.xlsx",
      "attached_assets/Internship_Hunt_(1)_1771028896356.xlsx"
    ];

    for (const file of files) {
      const fullPath = path.resolve(process.cwd(), file);
      await importXlsx(fullPath);
    }
    
    console.log("Database seeded from spreadsheets");
  }
}
