# Üçüncü taraf bileşenler / Third-party notices

Abi Player'ın kendi kodu [MIT lisansıyla](LICENSE) dağıtılır. Kurulum paketi
bunun yanında başkalarının yazdığı yazılımları da içerir; her biri aşağıda
belirtilen kendi lisansıyla gelir ve bu lisanslar Abi Player'ın MIT lisansıyla
değişmez.

Lisans metinleri depoda [`licenses/`](licenses) klasöründedir. Kurulu
uygulamada bu dosya `resources\legal\THIRD-PARTY-NOTICES.txt`, lisans
metinleri `resources\legal\licenses\`, Abi Player'ın kendi lisansı
`resources\legal\LICENSE.txt` olarak bulunur (yollar kurulum klasörüne
göredir). Uygulamada **Ayarlar → Destek → Lisanslar** bu dosyayı ve klasörü
açar.

mpv ve FFmpeg (ffmpeg, ffprobe) **ayrı programlardır**: Abi Player onları
kendi `.exe` dosyalarından alt süreç olarak başlatır; mpv ile bir adlandırılmış
kanal (JSON IPC) üzerinden, ffmpeg ve ffprobe ile komut satırı ve standart
çıktı üzerinden konuşur. Hiçbiri Abi Player'ın koduna bağlanmaz (linking),
Abi Player da onların koduna bağlanmaz. Paketteki ikililer yapı projelerinin
yayımladığı arşivlerden değiştirilmeden alınır; hangi arşivin alındığı
`scripts/mpv-pin.json` ve `scripts/ffmpeg-pin.json` dosyalarında boyut ve
SHA-256 özetiyle sabitlenmiştir.

**Kaynak kodu.** 0.5.0-beta sürümünden başlayarak, bir sürümdeki mpv ve FFmpeg
ikililerinin derlendiği kaynak kodu o sürümün
[GitHub sayfasına](https://github.com/enesbsafak/AbiPlayer/releases) ek dosya
olarak yüklenir (`source-*.tar.gz`): mpv, kurulumdaki FFmpeg, mpv içine gömülü
FFmpeg ve iki derleme projesinin betikleri, aşağıda adı geçen commit'lerden.
mpv derlemesine gömülü diğer kütüphanelerin tam sürümlerini derleme projesi
yayımlamaz; bunlar yalnızca derleme betikleri üzerinden gösterilebilir.

The notices below are in English, the language of the licences they refer to.
They describe the application as built from this repository with the pins named
above; when a pin or a dependency changes, this file has to be updated with it.

---

## 1. mpv

| | |
|:--|:--|
| Shipped as | `resources\mpv\`: the complete folder from the archive below, unchanged (`mpv.exe`, `mpv.com`, `d3dcompiler_43.dll`, `doc\`, `installer\`, `mpv\fonts.conf`, `mpv-register.bat`, `mpv-unregister.bat`, `updater.bat`) |
| Version | `mpv v0.42.0-38-gbcde6b93c`, built on Nov 11 2026 (from `mpv --version`) |
| Upstream source | <https://github.com/mpv-player/mpv>, commit [`bcde6b93cca4d128d84e1a60d1a6db2cd81c889e`](https://github.com/mpv-player/mpv/tree/bcde6b93cca4d128d84e1a60d1a6db2cd81c889e) (38 commits after tag `v0.42.0`, on `master`) |
| Binary build | [shinchiro/mpv-winbuild-cmake](https://github.com/shinchiro/mpv-winbuild-cmake), release [`20261111`](https://github.com/shinchiro/mpv-winbuild-cmake/releases/tag/20261111), asset `mpv-x86_64-20261111-git-bcde6b93cc.7z` (34181485 bytes, SHA-256 `f259b5fd4b5c395617c948a4fadcdf55bba1c5282fb7c13e88626b3f71072baf`) |
| Build scripts | tag `20261111` = commit [`bda10a2816ce9908d419b3f4b564227330457e76`](https://github.com/shinchiro/mpv-winbuild-cmake/tree/bda10a2816ce9908d419b3f4b564227330457e76), built by the GitHub Actions workflow "mpv clang", run [42927840447](https://github.com/shinchiro/mpv-winbuild-cmake/actions/runs/42927840447) |
| Licence | GNU General Public License; see below. Texts: [`licenses/GPL-3.0.txt`](licenses/GPL-3.0.txt), [`licenses/GPL-2.0.txt`](licenses/GPL-2.0.txt), mpv's own statement [`licenses/mpv-Copyright.txt`](licenses/mpv-Copyright.txt) |

**Licence of this build.** mpv states (file `Copyright` in its source, copied to
`licenses/mpv-Copyright.txt` from the commit above) that mpv as a whole is
licensed under the GNU GPL version 2 or later by default, and under the LGPL
version 2.1 or later only when built without the GPL-only files. This build
reports the `gpl` feature as enabled (`mpv -v --version`), so it is the GPL
build. mpv.exe also contains, statically linked, its own copy of FFmpeg
(`FFmpeg version: N-128766-gcd4e96eb3`, i.e. FFmpeg commit
[`cd4e96eb314630788b7ff2f9820c395788c023e2`](https://github.com/FFmpeg/FFmpeg/tree/cd4e96eb314630788b7ff2f9820c395788c023e2)),
which the build scripts configure with `--enable-gpl --enable-version3`
(`packages/ffmpeg.cmake` at the build-scripts commit above). FFmpeg built that
way is under the GNU GPL version 3, so the mpv.exe binary as a whole is
distributed under the terms of the **GNU GPL version 3**. The GPL version 2
text is included because mpv's own source files carry GPL-2.0-or-later (and
LGPL-2.1-or-later) notices.

Other libraries linked into mpv.exe are built by the `packages/*.cmake` files
of the build-scripts commit, each from its upstream repository. Besides FFmpeg,
`mpv --version` reports `libplacebo version: v7.391.0 (v7.387.0-37-gc2cf6e7-dirty)`;
`mpv -v --version` lists the enabled features:

```
amf build-date cplugins cuda-hwaccel cuda-interop d3d-hwaccel d3d11 d3d9-hwaccel
debug direct3d dos-paths dvda dvdnav dxgi-debug-d3d11 egl-angle egl-angle-win32
ffmpeg ffnvcodec gl gl-dxinterop gl-dxinterop-d3d9 gl-win32 glob glob-win32 gpl
iconv javascript jpeg lcms2 libarchive libass libavdevice libbluray libcurl
libplacebo luajit openal rubberband rubberband-3 sdl2-gamepad shaderc sixel
spirv-cross subrandr uchardet vaapi vaapi-win32 vapoursynth vector
vk-khr-display vulkan wasapi win32 win32-desktop win32-executable win32-smtc
win32-threads zimg zimg-st428 zlib
```

The archive contains no licence file of its own; the texts above are added by
Abi Player.

**Not open source:** `d3dcompiler_43.dll` in the same folder is a Microsoft
file ("Direct3D HLSL Compiler for Redistribution", file version 10.0.18362.1,
"© Microsoft Corporation. All rights reserved.") that the build project
includes in its archive. It is not covered by the GPL.

---

## 2. FFmpeg (ffmpeg, ffprobe)

| | |
|:--|:--|
| Shipped as | `resources\ffmpeg\`: `ffmpeg.exe`, `ffprobe.exe`, `avcodec-63.dll`, `avdevice-63.dll`, `avfilter-12.dll`, `avformat-63.dll`, `avutil-61.dll`, `swresample-7.dll`, `swscale-10.dll` and `LICENSE.txt`, unchanged from the archive below (its headers, import libraries, documentation and presets are not shipped) |
| Version | `ffmpeg version n9.0.2-39-g7adfbe40dc-20261031` (from `ffmpeg -version`; `ffprobe -version` reports the same) |
| Upstream source | <https://git.ffmpeg.org/ffmpeg.git> (mirror <https://github.com/FFmpeg/FFmpeg>), commit [`7adfbe40dcde598f93a6963d2f7b22cd75202ccc`](https://github.com/FFmpeg/FFmpeg/tree/7adfbe40dcde598f93a6963d2f7b22cd75202ccc) (39 commits after tag `n9.0.2`, on `release/9.0`) |
| Binary build | [FFmpeg-Builds/FFmpeg-Builds](https://github.com/FFmpeg-Builds/FFmpeg-Builds) (formerly `BtbN/FFmpeg-Builds`, which the release notes still link to), release [`autobuild-2026-10-31-12-59`](https://github.com/FFmpeg-Builds/FFmpeg-Builds/releases/tag/autobuild-2026-10-31-12-59), asset `ffmpeg-n9.0.2-39-g7adfbe40dc-win64-gpl-shared-9.0.zip` (85920857 bytes, SHA-256 `1d9823c35c7a7e2f54d1438cf61030d6efabe3278de01c191309d1e828bb74df`) |
| Build scripts | tag `autobuild-2026-10-31-12-59` = commit [`5031c6f1082414e53688d39e521849905071070d`](https://github.com/FFmpeg-Builds/FFmpeg-Builds/tree/5031c6f1082414e53688d39e521849905071070d); target `win64`, variant `gpl-shared`, addin `9.0`. Every external library is pinned to a commit in the matching file under `scripts.d/` of that commit |
| Licence | **GNU General Public License version 3**. Text: `resources\ffmpeg\LICENSE.txt` in the installed app, identical to [`licenses/GPL-3.0.txt`](licenses/GPL-3.0.txt) |

The build is configured with `--enable-gpl --enable-version3` and without
`--enable-nonfree` (see the `configuration:` line of `ffmpeg -version`, and
`variants/defaults-gpl.sh` of the build scripts), which makes FFmpeg as built
subject to the GNU GPL version 3. The build scripts copy FFmpeg's own
`COPYING.GPLv3` into the archive as `LICENSE.txt`; Abi Player ships that file
next to the executables. The external libraries compiled into the DLLs are
listed in the same `configuration:` line (`--enable-libx264`,
`--enable-libx265`, `--enable-libdav1d` and so on) and carry their own
licences in their upstream repositories.

---

## 3. Electron and Chromium

| | |
|:--|:--|
| Shipped as | the application runtime (`abi-player.exe` and the files next to it) |
| Version | Electron 45.3.2 (`package-lock.json`), with the Chromium, Node.js and V8 versions that release bundles |
| Source | <https://github.com/electron/electron/tree/v45.3.2> |
| Licence | Electron: MIT ([`licenses/Electron-LICENSE.txt`](licenses/Electron-LICENSE.txt), copied from `node_modules/electron/dist/LICENSE`). Chromium and the components it includes: their own licences, collected by the Chromium project in `LICENSES.chromium.html` |

electron-builder places `LICENSE.electron.txt` (Electron's licence) and
`LICENSES.chromium.html` (Chromium's credits with the full licence texts of its
components) in the installation folder, next to `abi-player.exe`.

---

## 4. Typefaces

| Typeface | Package | Files bundled | Copyright | Licence |
|:--|:--|:--|:--|:--|
| Bricolage Grotesque | `@fontsource-variable/bricolage-grotesque` 5.3.0 | `bricolage-grotesque-latin-opsz-normal.woff2`, `bricolage-grotesque-latin-ext-opsz-normal.woff2` | Copyright 2022 The Bricolage Grotesque Project Authors (https://github.com/ateliertriay/bricolage) | SIL Open Font License 1.1, [`licenses/OFL-1.1-Bricolage-Grotesque.txt`](licenses/OFL-1.1-Bricolage-Grotesque.txt) |
| DM Sans | `@fontsource-variable/dm-sans` 5.3.0 | `dm-sans-latin-opsz-normal.woff2`, `dm-sans-latin-ext-opsz-normal.woff2` | Copyright 2014 The DM Sans Project Authors (https://github.com/googlefonts/dm-fonts) | SIL Open Font License 1.1, [`licenses/OFL-1.1-DM-Sans.txt`](licenses/OFL-1.1-DM-Sans.txt) |

The font files are bundled into the renderer (`src/renderer/src/fonts.css`).
Each licence file is the `LICENSE` file of its npm package, with the font's own
copyright line at the top.

---

## 5. npm packages

The JavaScript packages whose code ends up in the application are listed, with
their versions, licences and full licence texts, in
[`licenses/npm-packages.txt`](licenses/npm-packages.txt). That file is generated
from `node_modules` by `npm run notices:npm` (`scripts/generate-npm-notices.mjs`).
A package is listed when it is

- a production dependency in `package.json` (`electron-updater`) or one of its
  dependencies, which electron-builder copies into `app.asar`; or
- bundled by Vite: imported at run time (not type-only) by the non-test source
  under `src/`, referenced by its CSS (the fonts), a dependency of such a
  package, or one of the two build tools that put their own code into the
  output (Vite's module preload helper, Tailwind CSS's base styles).

Tree-shaking can leave a listed package out of the bundle entirely, so the list
may include a few packages whose code is not actually shipped; it should not
miss any.

---

## 6. Installer

The Windows installer and uninstaller are built by electron-builder 26.18.1
with NSIS (Nullsoft Scriptable Install System). With no `toolsets.nsis` setting
in `electron-builder.yml`, electron-builder uses its NSIS 3.0.4.1 toolset. NSIS
is released under the zlib/libpng licence, with its bzip2 module under the
bzip2 licence and its LZMA module under the Common Public License 1.0; see
<https://nsis.sourceforge.io/License>.

---

## 7. TMDB

Film and series details can be enriched from The Movie Database (TMDB) when
the user enters their own TMDB API key. Abi Player does not ship TMDB content;
it requests it with the user's key at run time.

This application uses TMDB and the TMDB APIs but is not endorsed, certified, or
otherwise approved by TMDB.

(TMDB API Terms of Use, section 3 "Attribution",
<https://www.themoviedb.org/api-terms-of-use>.)
