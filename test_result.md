#====================================================================================================
# START - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================

# THIS SECTION CONTAINS CRITICAL TESTING INSTRUCTIONS FOR BOTH AGENTS
# BOTH MAIN_AGENT AND TESTING_AGENT MUST PRESERVE THIS ENTIRE BLOCK

# Communication Protocol:
# If the `testing_agent` is available, main agent should delegate all testing tasks to it.
#
# You have access to a file called `test_result.md`. This file contains the complete testing state
# and history, and is the primary means of communication between main and the testing agent.
#
# Main and testing agents must follow this exact format to maintain testing data. 
# The testing data must be entered in yaml format Below is the data structure:
# 
## user_problem_statement: {problem_statement}
## backend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.py"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## frontend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.js"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## metadata:
##   created_by: "main_agent"
##   version: "1.0"
##   test_sequence: 0
##   run_ui: false
##
## test_plan:
##   current_focus:
##     - "Task name 1"
##     - "Task name 2"
##   stuck_tasks:
##     - "Task name with persistent issues"
##   test_all: false
##   test_priority: "high_first"  # or "sequential" or "stuck_first"
##
## agent_communication:
##     -agent: "main"  # or "testing" or "user"
##     -message: "Communication message between agents"

# Protocol Guidelines for Main agent
#
# 1. Update Test Result File Before Testing:
#    - Main agent must always update the `test_result.md` file before calling the testing agent
#    - Add implementation details to the status_history
#    - Set `needs_retesting` to true for tasks that need testing
#    - Update the `test_plan` section to guide testing priorities
#    - Add a message to `agent_communication` explaining what you've done
#
# 2. Incorporate User Feedback:
#    - When a user provides feedback that something is or isn't working, add this information to the relevant task's status_history
#    - Update the working status based on user feedback
#    - If a user reports an issue with a task that was marked as working, increment the stuck_count
#    - Whenever user reports issue in the app, if we have testing agent and task_result.md file so find the appropriate task for that and append in status_history of that task to contain the user concern and problem as well 
#
# 3. Track Stuck Tasks:
#    - Monitor which tasks have high stuck_count values or where you are fixing same issue again and again, analyze that when you read task_result.md
#    - For persistent issues, use websearch tool to find solutions
#    - Pay special attention to tasks in the stuck_tasks list
#    - When you fix an issue with a stuck task, don't reset the stuck_count until the testing agent confirms it's working
#
# 4. Provide Context to Testing Agent:
#    - When calling the testing agent, provide clear instructions about:
#      - Which tasks need testing (reference the test_plan)
#      - Any authentication details or configuration needed
#      - Specific test scenarios to focus on
#      - Any known issues or edge cases to verify
#
# 5. Call the testing agent with specific instructions referring to test_result.md
#
# IMPORTANT: Main agent must ALWAYS update test_result.md BEFORE calling the testing agent, as it relies on this file to understand what to test next.

#====================================================================================================
# END - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================



#====================================================================================================
# Testing Data - Main Agent and testing sub agent both should log testing data below this section
#====================================================================================================

user_problem_statement: |
  Fase 1 fitur baru untuk KasirKu Pro:
  1. Diskon per-item di kasir (nominal Rp atau persen %)
  2. Export laporan ke PDF/Excel per periode custom (date range picker + preset)
  3. Buku Panduan Manual (in-app help offline)
  Backend changes: /reports/* endpoints now support period=custom&start=YYYY-MM-DD&end=YYYY-MM-DD. New endpoint /reports/export (xlsx multi-sheet).

backend:
  - task: "Custom period support on reports endpoints"
    implemented: true
    working: "NA"
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: "Added _period_range + _date_filter helpers. Updated /reports/summary, /reports/products, /reports/customers, /reports/operators, /reports/sales-items to accept Literal['daily','monthly','yearly','custom'] period plus optional start=YYYY-MM-DD and end=YYYY-MM-DD query params. Backward compatible with existing non-custom calls."
  - task: "Excel multi-sheet laporan export"
    implemented: true
    working: "NA"
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: "GET /api/reports/export?period=<p>&start=&end= — returns xlsx streaming with 6 sheets: Ringkasan, Per Produk, Per Pelanggan, Per Operator, Detail Barang, Detail Transaksi. Uses pandas + xlsxwriter."

frontend:
  - task: "Bluetooth Thermal Printer (ESC/POS) - real implementation"
    implemented: true
    working: "NA"
    file: "/app/frontend/src/bt-printer.ts, /app/frontend/app/bluetooth-printer.tsx, /app/frontend/app/receipt.tsx, /app/frontend/app/settings.tsx, /app/frontend/app/(tabs)/lainnya.tsx"
    stuck_count: 1
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: |
          Attempt 1 (DEPRECATED): Used react-native-thermal-printer-driver@0.1.1 (TurboModule). Native build crashed on launch & on Laporan tab because the TurboModule failed to register properly on APK. 
      - working: false
        agent: "user"
        comment: "APK showed 'JTPOIN POS terus berhenti' native crash when opening Laporan + printer unable to print."
      - working: "NA"
        agent: "main"
        comment: |
          Switched library to `rn-bluetooth-classic-printer@0.2.1` (uses expo-modules-core, Expo-autolinked, OLD architecture compatible, Android Bluetooth Classic SPP only). This library is reliable because:
            - Pattern follows standard Expo module registration (no fragile TurboModule init at launch).
            - Lazy require() in bt-printer.ts so web/Expo Go never loads native code → zero crash in those environments.
            - User wanted direct Bluetooth printing (no RawBT dependency); this library writes raw ESC/POS bytes directly to a paired Bluetooth printer via SPP.
          bt-printer.ts now has: scanPrinters (paired + discovery), connectPrinter, savePairedPrinter (SecureStore), testPrint (greeting + cut), printReceipt (full tx struk 58/80mm, cash drawer), openCashDrawerOnly, openBluetoothSettings (Linking.sendIntent BLUETOOTH_SETTINGS).
          Android runtime permissions handled with PermissionsAndroid.requestMultiple (BLUETOOTH_SCAN/CONNECT on API 31+, ACCESS_FINE_LOCATION on older). On NEVER_ASK_AGAIN → clear direction to open Settings.
          User must rebuild APK to use new library (previous APK still contains the crashing TurboModule).
  - task: "Diskon per-item di kasir"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/(tabs)/index.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: "Added manual_discount field to CartItem. New tombol '+ Tambah diskon' per cart line inside Checkout sheet opens modal to pick type (Nominal Rp / Persen %) and value. Promos still work on top via appliedCart (which starts from manual_discount, promos may add more)."
  - task: "Custom date range + Excel export di Laporan"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/(tabs)/laporan.tsx"
    stuck_count: 1
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: "Added 'Custom periode' chip which opens date range modal (YYYY-MM-DD inputs + preset chips: 7 hari / 30 hari / Bulan lalu). Added Export Excel button that downloads multi-sheet xlsx via downloadReportsExcel helper and shares via expo-sharing."
      - working: false
        agent: "user"
        comment: "Bug: Laporan tab crashes app immediately on APK Android build. App exits when user taps Laporan."
      - working: "NA"
        agent: "main"
        comment: |
          Hardened Laporan tab to prevent native crash:
            - Each of 6 API endpoints now uses `safely<T>()` wrapper so one failure doesn't blank whole screen (previous Promise.all would reject all).
            - Removed double-fetch race: useFocusEffect now handles both initial-load and period-change (was duplicated with useEffect).
            - Removed `toast` from useCallback deps that could trigger infinite re-render if ToastProvider state changed.
            - Guarded all date math with try/catch + /^\\d{4}-\\d{2}-\\d{2}$/ validation before new Date(…).toISOString().
            - Array.isArray guard on every state setter so malformed server response can't crash the renderer.
            - Reduced /transactions limit from 500 → 300 and cap display slice to 200 to avoid Hermes OOM on low-RAM Android phones.
            - Defensive null-coalesce on every render field (t.items?.length, c.customer_name ?? "Umum", r.name ?? "-", etc.) so a single malformed doc can't throw a TypeError that bubbles past the ErrorBoundary.
  - task: "Buku Panduan Manual"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/manual.tsx"
    stuck_count: 0
    priority: "medium"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: "Created /manual route with 9 collapsible sections covering onboarding, kasir, stok, laporan, arus-kas, struk, offline, operator, FAQ. Linked from Lainnya menu with book-outline icon."

metadata:
  created_by: "main_agent"
  version: "1.1"
  test_sequence: 10
  run_ui: false

test_plan:
  current_focus:
    - "Custom period support on reports endpoints"
    - "Excel multi-sheet laporan export"
  stuck_tasks: []
  test_all: false
  test_priority: "high_first"

agent_communication:
  - agent: "main"
    message: |
      Fase 1 selesai (3 fitur baru + backend custom period). Fokus testing:
      1. Backend: /api/reports/summary?period=custom&start=2026-05-01&end=2026-06-30 (dan tanpa custom tetap jalan untuk daily/monthly/yearly)
      2. Backend: /api/reports/products, /customers, /operators, /sales-items dengan period=custom
      3. Backend: GET /api/reports/export?period=monthly dan period=custom (should return .xlsx stream dengan 6 sheets)
      4. Backend regression: pastikan /transactions, /sales-items, /summary biasa tetap jalan tanpa break
      Kredensial di /app/memory/test_credentials.md (admintoko/admin123). Jika belum ada data transaksi, buat dulu beberapa produk + transaksi dummy via API lalu test endpoints.