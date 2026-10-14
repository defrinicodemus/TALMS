# Review kandidat cleanup komponen dan dependensi

Tanggal pemeriksaan: 12 Oktober 2026.

Status: penghapusan selesai setelah persetujuan pengguna. Tepat 26 file dan 21 dependensi langsung telah dihapus; npm juga menghapus 7 dependensi transitif yang tidak lagi dibutuhkan.

## Hasil pemeriksaan sebelum penghapusan

- Menelusuri import, re-export, dan pemanggilan import/require pada 199 file sumber dari 38 entry point Next.js.
- Memeriksa referensi path yang tepat pada 228 file sumber, tes, konfigurasi, dan dokumentasi. Tidak ditemukan referensi ke kandidat dari luar kelompok kandidat.
- Memeriksa dua pemanggilan `require(name)` pada loader tes; keduanya memuat modul berdasarkan import kode atau daftar modul tes yang diperiksa.
- Memeriksa dependencies, optionalDependencies, dan peerDependencies pada `package-lock.json`. Tidak ada paket di luar kelompok usulan penghapusan yang mendeklarasikan kebutuhan terhadap 21 paket kandidat.
- Memeriksa import CSS dan konfigurasi agar paket yang dipakai di luar TypeScript tidak keliru dianggap tidak digunakan.

## 26 file yang telah dihapus

25 file berikut telah dihapus dari `src/components/ui/`. Sebelum penghapusan, komponen ini tidak terhubung ke entry point aplikasi dan tidak direferensikan tes atau konfigurasi. Ini adalah komponen pembungkus yang tidak dipakai; form, tabel, grafik, dan fitur aplikasi yang menggunakan komponen lain tetap tersedia.

| File                  | Paket khusus yang menjadi kandidat penghapusan |
| --------------------- | ---------------------------------------------- |
| `accordion.tsx`       | `@radix-ui/react-accordion`                    |
| `alert.tsx`           | Tidak ada                                      |
| `aspect-ratio.tsx`    | `@radix-ui/react-aspect-ratio`                 |
| `avatar.tsx`          | `@radix-ui/react-avatar`                       |
| `badge.tsx`           | Tidak ada                                      |
| `breadcrumb.tsx`      | Tidak ada                                      |
| `calendar.tsx`        | `react-day-picker`                             |
| `carousel.tsx`        | `embla-carousel-react`                         |
| `chart.tsx`           | Tidak ada; `recharts` tetap dipakai dashboard  |
| `collapsible.tsx`     | `@radix-ui/react-collapsible`                  |
| `context-menu.tsx`    | `@radix-ui/react-context-menu`                 |
| `drawer.tsx`          | `vaul`                                         |
| `form.tsx`            | `react-hook-form`                              |
| `hover-card.tsx`      | `@radix-ui/react-hover-card`                   |
| `input-otp.tsx`       | `input-otp`                                    |
| `menubar.tsx`         | `@radix-ui/react-menubar`                      |
| `navigation-menu.tsx` | `@radix-ui/react-navigation-menu`              |
| `pagination.tsx`      | Tidak ada                                      |
| `radio-group.tsx`     | `@radix-ui/react-radio-group`                  |
| `resizable.tsx`       | `react-resizable-panels`                       |
| `scroll-area.tsx`     | `@radix-ui/react-scroll-area`                  |
| `switch.tsx`          | `@radix-ui/react-switch`                       |
| `table.tsx`           | Tidak ada                                      |
| `toggle-group.tsx`    | `@radix-ui/react-toggle-group`                 |
| `toggle.tsx`          | `@radix-ui/react-toggle`                       |

File ke-26: `src/lib/supabase/client.ts`. Helper `createClient()` untuk browser ini tidak memiliki pemanggil. Helper Supabase untuk server, middleware, dan admin tetap dipakai dan harus dipertahankan, bersama paket Supabase.

`toggle-group.tsx` mengimpor `toggle.tsx`; keduanya harus dihapus bersama. `alert-dialog.tsx`, `dialog.tsx`, `select.tsx`, `table` HTML, form aplikasi, dan grafik dashboard bukan bagian dari penghapusan ini.

## 21 dependensi langsung yang telah dihapus

Daftar tepat untuk perubahan `package.json` dan pembaruan `package-lock.json`:

```text
@hookform/resolvers
@radix-ui/react-accordion
@radix-ui/react-aspect-ratio
@radix-ui/react-avatar
@radix-ui/react-collapsible
@radix-ui/react-context-menu
@radix-ui/react-hover-card
@radix-ui/react-menubar
@radix-ui/react-navigation-menu
@radix-ui/react-radio-group
@radix-ui/react-scroll-area
@radix-ui/react-switch
@radix-ui/react-toggle
@radix-ui/react-toggle-group
date-fns
embla-carousel-react
input-otp
react-day-picker
react-hook-form
react-resizable-panels
vaul
```

`@hookform/resolvers` tidak memiliki import di aplikasi atau tes. `date-fns` tidak dipakai langsung; pada lockfile saat ini hanya dibutuhkan oleh `react-day-picker`, yang juga menjadi kandidat penghapusan. Kebutuhan antarpaket lain yang ditemukan hanya berada di kelompok ini: accordion membutuhkan collapsible, toggle-group membutuhkan toggle, dan resolvers membutuhkan react-hook-form.

Penghapusan paket harus melalui npm agar lockfile tetap konsisten. Dependensi transitif akan ditentukan ulang oleh npm; jangan menghapus entri lockfile atau folder `node_modules` secara manual.

## Paket yang tetap dipertahankan

| Paket                                     | Alasan                                                                                                                          |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `@tiptap/pm`                              | Dibutuhkan oleh core, React integration, extension, dan starter-kit Tiptap, walaupun tidak diimpor langsung dari kode aplikasi. |
| `recharts`                                | Diimpor langsung oleh dashboard Admin, Guru, Kepala Sekolah, dan halaman Kinerja Guru.                                          |
| `react-dom`                               | Dibutuhkan React/Next.js dan tes UI.                                                                                            |
| `tailwindcss`, `tw-animate-css`           | Diimpor oleh `src/app/globals.css`; Tailwind juga dipakai konfigurasi PostCSS.                                                  |
| `@supabase/ssr`, `@supabase/supabase-js`  | Tetap dipakai akses Supabase dari server dan pemeriksaan sesi.                                                                  |
| `xlsx`, `fflate`                          | Tetap dipakai ekspor dan tes ekspor.                                                                                            |
| `cmdk`                                    | Komponen command dipakai pada Master Kelas.                                                                                     |
| Paket lainnya dan seluruh devDependencies | Tidak termasuk usulan penghapusan ini.                                                                                          |

## Hasil verifikasi setelah penghapusan

- `npm uninstall` dijalankan menggunakan paket lokal, dengan lifecycle scripts dinonaktifkan. Lockfile diperbarui oleh npm.
- Tepat 26 file yang disetujui telah dihapus. Perubahan cleanup sebelumnya dipertahankan.
- Tepat 21 dependensi langsung dan 7 dependensi transitif dihapus. Tidak ada paket yang ditambahkan atau versi paket yang tetap dipakai berubah. `devDependencies` dan scripts tetap sama dengan awal tahap ini.
- `package.json` dan root dependencies pada `package-lock.json` konsisten. `npm ls --depth=0` berhasil tanpa laporan dependensi hilang atau invalid.
- `npm run lint`: lulus, 0 error dan 0 warning.
- `npm run typecheck`: lulus.
- Tes keamanan dan UI: 325 lulus, 0 gagal, 0 dilewati.
- `npm run build`: lulus. Peringatan existing tentang konvensi `middleware` yang digantikan `proxy` masih ada; migrasi tersebut tidak termasuk cleanup ini.
- Server produksi lokal: `/login` mengembalikan HTTP 200 beserta form login dan stylesheet yang berhasil dimuat. Tanpa sesi login, `/dashboard`, `/users`, `/master-kelas`, dan `/api/exports/school` mengarahkan ke `/login` dengan HTTP 307.
- Schema, database, query aktif, dan alur bisnis tidak diubah.

## Dampak CSS dan batas pengujian

Total kode sumber yang dihapus sekitar 78 KiB. Angka ini bukan ukuran JavaScript yang dikirim ke browser.

`globals.css` menggunakan `@source "../"`, sehingga file UI yang tidak diimpor pun menyumbang utility CSS saat build. CSS produksi turun dari 112.298 byte menjadi 92.406 byte, berkurang 19.892 byte atau sekitar 17,7% sebelum kompresi jaringan.

Perbandingan selector CSS dengan kandidat class yang dibaca scanner Tailwind dari sumber yang tersisa tidak menemukan class yang masih dipakai ikut hilang. Deklarasi selector yang tetap ada tidak mengalami penambahan atau penghapusan; hanya urutan deklarasi inisialisasi properti internal Tailwind yang berubah. Template class dinamis yang ditinjau menggunakan nama class lengkap dari kondisi atau pemetaan.

Browser tidak tersedia pada sesi pengujian ini (`Browser is not available: iab`). Karena itu, pengujian visual langsung dan login dengan akun pengguna belum dilakukan. Tes UI otomatis mencakup modal/dropdown Admin; tes ekspor menggunakan data uji. Hasil HTTP tanpa sesi tidak membuktikan seluruh alur sesudah login.

Pemeriksaan manual yang masih disarankan: buka dashboard tiap role, sidebar, modal/dropdown Admin, tabel/form, grafik, editor, dan unduhan ekspor memakai akun uji. Peningkatan waktu muat halaman belum diukur.

## Optimasi query Manajemen Pengguna

Status: selesai diterapkan setelah persetujuan pengguna. [USER_QUERY_CLEANUP.patch](USER_QUERY_CLEANUP.patch) disimpan sebagai arsip perubahan yang telah diterapkan, bukan patch yang perlu dijalankan kembali.

Kedua helper pada `src/lib/data/people.ts` hanya dipanggil oleh `src/app/(app)/users/page.tsx`. Panel Siswa memakai identitas serta penempatan kelas, sedangkan Panel Guru memakai identitas serta array penugasan mengajar. Pencarian, filter, form edit, dan badge penugasan tidak membaca statistik yang diusulkan untuk dihapus.

| Pembacaan yang dihapus dari helper daftar pengguna | Alasan                                                                  |
| -------------------------------------------------- | ----------------------------------------------------------------------- |
| `grades.select("student_id, score")`               | Rata-rata siswa (`avg`) tidak digunakan Panel Siswa.                    |
| `materials.select("teacher_id")`                   | Jumlah materi guru (`materials`) tidak digunakan Panel Guru.            |
| `assignments.select("teacher_id")`                 | Jumlah aktivitas yang diberi nama `quizzes` tidak digunakan Panel Guru. |

Perubahan diterapkan pada empat file:

1. `src/lib/data/people.ts`: hapus tiga query dan perhitungan statistiknya, import `round2`, serta properti hasil `avg`, `materials`, `quizzes`, dan `subject` yang tidak dipakai. Ganti nama helper menjadi `listStudents()` dan `listTeachersWithTeaching()` agar sesuai hasilnya.
2. `src/app/(app)/users/page.tsx`: sesuaikan import dan pemanggilan kedua helper.
3. `src/app/(app)/users/TeachersPanel.tsx`: hapus dua properti statistik yang tidak dipakai dari tipe `Teacher`; JSX dan interaksi panel tetap sama.
4. `tests/ui/admin-dialogs.test.mjs`: sesuaikan satu fixture guru agar tidak lagi membawa properti statistik yang dihapus.

Query profil, kelas siswa, penugasan guru, nama mapel, tahun ajaran, status aktif, dan urutan data dipertahankan. `requireRole(["admin"])`, server action CRUD, reset password, serta pemeriksaan blocker sebelum menghapus akun tidak termasuk perubahan. Pembacaan nilai di `deleteStudent()` tetap diperlukan dan tidak dihapus. Tidak ada migrasi atau penghapusan data database.

Hasil verifikasi sebelum penerapan:

- `git apply --check USER_QUERY_CLEANUP.patch`: lulus; patch cocok dengan kode saat pemeriksaan.
- Pemeriksaan TypeScript dengan overlay draf di memori: 0 error; source aplikasi belum ditulis.
- Lint terhadap isi empat file dalam draf: 0 error dan 0 warning.
- Perbandingan hasil lama dan draf menggunakan mock Supabase: empat skenario lulus, meliputi siswa dengan/tanpa kelas, identitas dan relasi kosong, penugasan beberapa periode, daftar kosong, serta hasil query null. Semua properti yang tetap dipakai panel identik, termasuk urutan penugasan guru.
- Query pada kedua helper berkurang dari 6 menjadi 3. Angka ini tidak mencakup query autentikasi, layout, dan helper halaman lainnya; tidak berarti waktu muat halaman turun 50%.
- Pemeriksaan draf tidak mengakses database live.

Hasil verifikasi sesudah penerapan:

- Isi keempat file sesuai persis dengan draf yang disetujui. Tidak ada pemanggilan nama helper lama yang tersisa pada kode aplikasi atau tes.
- `npm run lint`: lulus, 0 error dan 0 warning.
- `npm run typecheck`: lulus.
- Tes keamanan dan UI: 325 lulus, 0 gagal, 0 dilewati.
- `npm run build`: lulus. Peringatan existing `middleware` ke `proxy` masih ada dan berada di luar scope perubahan ini.
- Empat skenario perbandingan dengan mock Supabase dijalankan ulang terhadap implementasi aktual: seluruh data yang dipakai panel tetap sama dan query pada dua helper berkurang dari 6 menjadi 3.
- Diff ditinjau: `StudentsPanel.tsx`, server action pengguna, role guard, dan `gradebook.ts` tidak berubah. Tidak ada migrasi atau mutasi database.
- Pengujian browser dengan akun Admin dan pengukuran waktu muat menggunakan database live belum dilakukan. Pemeriksaan manual yang disarankan: pencarian siswa lintas periode, filter tahun/kelas, daftar siswa tanpa kelas, badge penugasan guru dan tombol tampilkan lainnya, serta form edit siswa/guru.

## Pemuatan Excel saat ekspor

Status: selesai diterapkan setelah persetujuan pengguna.

File pada tahap ini:

- `src/app/(app)/attendance/AttendanceRecapDialog.tsx`
- `src/app/(app)/gradebook/GradebookManager.tsx`
- `tests/ui/excel-exports.test.mjs` (baru)
- `CLEANUP_REVIEW.md`

Import awal `xlsx` pada kedua komponen diganti dengan `await import("xlsx")` di handler ekspor. Tombol menampilkan "Menyiapkan Excel…" dan spinner selama proses, memakai `aria-busy`, serta dinonaktifkan sementara. Ref melindungi handler dari klik berulang sebelum render berikutnya. Error pemuatan atau pembuatan file menampilkan toast, dan `finally` memulihkan tombol agar dapat dicoba lagi. Selector kelas/mapel Buku Nilai dinonaktifkan selama ekspor agar konteks unduhan tetap jelas.

Nama file, nama sheet, urutan kolom, pemetaan status presensi, NISN, dan nilai tetap mengikuti implementasi sebelumnya. Rekap tanpa pertemuan serta buku nilai yang belum dikunci tetap tidak dapat diekspor. Query, server action, perhitungan nilai, schema, dan data database tidak berubah. Ekspor ZIP data sekolah tetap menggunakan implementasi sebelumnya.

Hasil verifikasi:

- Delapan tes baru menggunakan komponen React dan Button/Select asli, mock pemuatan library dan server action, serta pembentukan dan pembacaan kembali XLSX di memori. Tidak ada akses Supabase atau penulisan berkas unduhan ke disk.
- Tes mencakup pemuatan hanya setelah klik, status menunggu, klik berulang, kegagalan pemuatan/pembuatan file dan percobaan ulang, pembatasan ekspor sebelumnya, serta kesamaan nama file, sheet, kolom, status presensi, NISN dengan nol di depan, nilai nol/desimal, dan data kosong pada sel.
- `npm run lint`: lulus, 0 error dan 0 warning.
- `npm run typecheck`: lulus.
- Seluruh tes keamanan dan UI: 333 lulus, 0 gagal, 0 dilewati.
- `npm run build`: lulus. Peringatan existing tentang `middleware` ke `proxy` masih ada.
- Diff ditinjau dan `git diff --check` lulus.

Manifest hasil build menunjukkan implementasi `xlsx` tidak lagi menjadi dependensi chunk awal kedua halaman. Perbandingan jumlah byte chunk awal untuk referensi komponen terkait:

| Komponen | Sebelum | Sesudah | Pengurangan |
| --- | ---: | ---: | ---: |
| AttendanceManager (termasuk dialog rekap) | 606.536 | 306.113 | 300.423 |
| GradebookManager | 619.280 | 318.899 | 300.381 |

Angka ini merupakan byte JavaScript sebelum kompresi, termasuk chunk bersama yang dicantumkan manifest komponen, bukan ukuran seluruh halaman atau hasil pengukuran waktu muat. Penghematan kedua halaman tidak dijumlahkan karena memakai library yang sama. Library tetap dibutuhkan saat ekspor: chunk awal library sebelumnya berukuran 301.038 byte; chunk asinkron hasil build sekarang 434.192 byte. Artinya beban awal berkurang, tetapi total kode jika pengguna melakukan ekspor tidak ikut mengecil, dan ekspor pertama perlu menunggu pemuatan library.

Browser tidak tersedia pada sesi ini, sehingga unduhan melalui browser dengan akun Guru belum diuji langsung. Pemeriksaan manual yang disarankan:

1. Buka Rekap Presensi untuk kelas/mapel dengan pertemuan, lalu klik Ekspor ke Excel. Periksa nama file, NISN, urutan pertemuan, dan status kehadiran.
2. Buka Buku Nilai yang telah dikunci dan ekspor. Periksa nama kelas/mapel, kolom TP, serta nilai nol, desimal, dan sel tanpa nilai. Buku yang belum dikunci tetap tidak dapat diekspor.
3. Dengan jaringan lambat, periksa indikator proses dan pastikan klik berulang menghasilkan satu unduhan. Selector Buku Nilai aktif kembali setelah selesai.
4. Pada build produksi dengan cache browser kosong, periksa Network: chunk Excel diminta setelah klik ekspor. Jika pemuatan chunk gagal, toast muncul dan tombol dapat dicoba lagi atau halaman dimuat ulang.
