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
Bu commit'ler `scripts/mpv-pin.json` ve `scripts/ffmpeg-pin.json` dosyalarının
`sources` kaydındadır; sürüm betiği (`npm run release:win`) arşivleri bu
kayıttan indirir, her birinin doğru commit'ten yapıldığını denetler ve kurulum
dosyasıyla birlikte yükler. mpv derlemesine gömülü diğer kütüphanelerden
commit'i derleme kayıtlarından çıkarılabilenler bölüm 1'deki tablodadır;
geri kalanların commit'ini derleme projesi hiçbir yerde kaydetmemiştir.

The notices below are in English, the language of the licences they refer to.
They describe the application as built from this repository with the pins named
above; when a pin or a dependency changes, this file has to be updated with it.

---

## 1. mpv

| | |
|:--|:--|
| Shipped as | `resources\mpv\`: `mpv.exe`, `mpv.com` and `mpv\fonts.conf`, unchanged from the archive below (plus Abi Player's own `.mpv-source.json` record of the pin). The archive's `d3dcompiler_43.dll`, `doc\`, `installer\`, `mpv-register.bat`, `mpv-unregister.bat` and `updater.bat` are not shipped; see below |
| Version | `mpv v0.42.0-38-gbcde6b93c`, built on Nov 11 2026 (from `mpv --version`) |
| Upstream source | <https://github.com/mpv-player/mpv>, commit [`bcde6b93cca4d128d84e1a60d1a6db2cd81c889e`](https://github.com/mpv-player/mpv/tree/bcde6b93cca4d128d84e1a60d1a6db2cd81c889e) (38 commits after tag `v0.42.0`, on `master`) |
| Binary build | [shinchiro/mpv-winbuild-cmake](https://github.com/shinchiro/mpv-winbuild-cmake), release [`20261111`](https://github.com/shinchiro/mpv-winbuild-cmake/releases/tag/20261111), asset `mpv-x86_64-20261111-git-bcde6b93cc.7z` (34181485 bytes, SHA-256 `f259b5fd4b5c395617c948a4fadcdf55bba1c5282fb7c13e88626b3f71072baf`) |
| Build scripts | tag `20261111` = commit [`bda10a2816ce9908d419b3f4b564227330457e76`](https://github.com/shinchiro/mpv-winbuild-cmake/tree/bda10a2816ce9908d419b3f4b564227330457e76), built by the GitHub Actions workflow "mpv clang", run [42927840447](https://github.com/shinchiro/mpv-winbuild-cmake/actions/runs/42927840447) |
| Source archives on the release page | `source-mpv-bcde6b93cc.tar.gz` (mpv-player/mpv), `source-ffmpeg-in-mpv-cd4e96eb3.tar.gz` (FFmpeg/FFmpeg), `source-mpv-build-scripts-20261111.tar.gz` (shinchiro/mpv-winbuild-cmake): GitHub's archive of each commit named in this section |
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
of the build-scripts commit, each from its upstream repository; the patches the
build applies to some of them (curl, fontconfig, libbs2b, libvpl, luajit, mujs,
openssl, spirv-cross, vulkan) are in the same `packages/` folder. Besides FFmpeg,
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

**Which library versions went into mpv.exe.** The build scripts fetch most
libraries from the current head of a branch at build time, and the build
project does not publish which commits a release was built from: the release
page names only the workflow run, and the run's per-package log archive
(artifact `mpv-x86_64-logs`) is no longer available (GitHub answers 404). What
remains is the console log of the job "Building mpv (x86_64)" of run
42927840447, read through the GitHub API on 2026-11-15. Its `ninja update` step
prints, for each git package, the branches that moved since the build's cached
checkout, and resets a package to the fetched head of its branch when that head
differs from the cached one ("Removing ... stamp files"). The dependency closure
of the `mpv` target in the build scripts has 85 packages, mpv and FFmpeg
included. Of the 83 besides mpv and FFmpeg:

- 19 were reset to a branch head printed in the log. The commit is that head,
  resolved to its full hash in the upstream repository. Read the same way, the
  log gives exactly the mpv, FFmpeg and libplacebo commits that the binary
  itself reports.

| Package | Upstream | Commit |
|:--|:--|:--|
| angle-headers | <https://github.com/google/angle> | `b4e3e8b5216fc18e0d2c76701660715892e1b4ea` |
| aom | <https://aomedia.googlesource.com/aom> | `e72b85589b0117347dcf52915646209a4d1dc418` |
| freetype2 | <https://github.com/freetype/freetype> | `6065d6a40effdef3d5756642378c2b683dfc51d5` |
| glslang | <https://github.com/KhronosGroup/glslang> | `b2e081c8eb3ee90415908b7637c1ae429994bddc` |
| harfbuzz | <https://github.com/harfbuzz/harfbuzz> | `edca03eadb7aca72b847d80220d7c4466a66508c` |
| lcms2 | <https://github.com/mm2/Little-CMS> | `780da288c125aab1550619b82d8f869e5b48ecfb` |
| libarchive | <https://github.com/libarchive/libarchive> | `d0bf2da07ebaa3964090ee936edea538d1602449` |
| libass | <https://github.com/libass/libass> | `21b5a54fceff49c126c201d4b51c6445287a5072` |
| libjxl | <https://github.com/libjxl/libjxl> | `153aa4adf1f25a3373aa9324885c777aca8f0904` |
| libplacebo | <https://github.com/haasn/libplacebo> | `c2cf6e72daee00cbb8ef089059a5d12c06018cbd` |
| libsrt | <https://github.com/Haivision/srt> | `80e0bc48adb8dbc0d4d4635a65a08f31ebd20022` |
| libwebp | <https://chromium.googlesource.com/webm/libwebp> | `c3fe5bb655e99ede84f7b2766fc75a8f1d8bbf9e` |
| mujs | <https://codeberg.org/ccxvii/mujs> | `21768ba7c0b7d82633c987a3f02c7e97eeec7919` |
| nghttp2 | <https://github.com/nghttp2/nghttp2> | `d4f22e4bbc168b0aec60e948bb8690e6036ddbb2` |
| openal-soft | <https://github.com/kcat/openal-soft> | `20b56ce9f5a1cc6ed8c41547e960e37e9f47bdd2` |
| spirv-tools | <https://github.com/KhronosGroup/SPIRV-Tools> | `251c437ef506157c139f77f5525c02223bc78868` |
| vulkan | <https://github.com/KhronosGroup/Vulkan-Loader> | `41fb81bcf0e98a74100be22dbdcf1ca6063a3ec1` |
| x265 | <https://github.com/Multicorewareinc/x265> | `9bb47b765b438f136364848fd4592fc692a8cf77` |
| zstd | <https://github.com/facebook/zstd> | `4dde8bf8c4461ca8fbfb734992b09fac8da43139` |

- 10 are fixed by the build scripts themselves, to a commit (`GIT_RESET`) or to
  a release archive with its checksum (`URL_HASH`):

| Package | Upstream | Fixed in the build scripts |
|:--|:--|:--|
| avisynth-headers | <https://github.com/AviSynth/AviSynthPlus> | commit `21fdc997f9724b994896ba5520ddf64d677976b3` |
| libiconv | <https://ftp.gnu.org/pub/gnu/libiconv/libiconv-1.18.tar.gz> | release archive, `SHA256` `3b08f5f4f9b4eb82f151a7040bfd6fe6c6fb922efe4b1659c66ea933276965e8` |
| libopenmpt | <https://lib.openmpt.org/files/libopenmpt/src/libopenmpt-0.7.12+release.autotools.tar.gz> | release archive, `SHA256` `79ab3ce3672601e525b5cc944f026c80c03032f37d39caa84c8ca3fdd75e0c98` |
| libpsl | <https://github.com/rockdaboot/libpsl> | commit `aa3a80e18f25caf3916636c8668dcc0fff7c016d` |
| libsixel | <https://github.com/saitoha/libsixel> | commit `af12e5bc6f3f69ad83479da85ddb371420da9b17` |
| lzo | <https://www.oberhumer.com/opensource/lzo/download/lzo-2.10.tar.gz> | release archive, `SHA1` `4924676a9bae5db58ef129dc1cebce3baa3c4b5d` |
| openssl | <https://github.com/openssl/openssl> | commit `d8bf6cdd4849925c30e4f1911c7acb49cb34b702` |
| opus-dnn | <https://media.xiph.org/opus/models/opus_data-8a07d57c4fce6fb30f23b3e0d264004e04f1d7b421f5392ef61543d021a439af.tar.gz> | release archive, `SHA256` `8a07d57c4fce6fb30f23b3e0d264004e04f1d7b421f5392ef61543d021a439af` |
| vapoursynth | <https://github.com/vapoursynth/vapoursynth> | commit `e46204429041e95a881b61eedddd46c08f9a307c` |
| xz | <https://github.com/tukaani-project/xz> | commit `3d078b52adbff566ccfc51067dfbf742ecf3ef86` |

- 54 are not recorded anywhere we could find. They did not change in this run
  (`curl` is excluded from the update step), so they were built from a checkout
  cached by earlier runs, and the log does not print its commit. Their source
  is identified only by the repository and branch in `packages/<name>.cmake` of
  the build-scripts commit: `amf-headers`, `brotli`, `bzip2`, `c-ares`, `curl`, `dav1d`, `davs2`, `fast_float`, `fontconfig`, `fribidi`, `glad`, `graphengine`, `highway`, `lame`, `libaribcaption`, `libbluray`, `libbs2b`, `libdvdnav`, `libdvdread`, `libjpeg`, `libmodplug`, `libmysofa`, `libpng`, `libsamplerate`, `libsdl2`, `libsoxr`, `libssh`, `libudfread`, `libunibreak`, `libva`, `libvpl`, `libvpx`, `libxml2`, `libzimg`, `libzvbi`, `luajit`, `nghttp3`, `ngtcp2`, `nvcodec-headers`, `ogg`, `opus`, `rubberband`, `shaderc`, `speex`, `spirv-cross`, `spirv-headers`, `subrandr`, `svtav1`, `uavs3d`, `uchardet`, `vorbis`, `x264`, `xxhash`, `zlib`.

(`x265-8+10bit` and `x265-10bit-lib` are further build targets of the `x265`
source and are not counted separately. The closure also contains header-only
packages such as `amf-headers`, `angle-headers` and `nvcodec-headers`.)

**Files of the archive that are not shipped.** `installer\`,
`mpv-register.bat`, `mpv-unregister.bat` and `updater.bat` register mpv as a
desktop player or replace it with a newer download; nothing in Abi Player runs
them. `doc\` holds mpv's manual. `d3dcompiler_43.dll` is a Microsoft file
("Direct3D HLSL Compiler for Redistribution", file version 10.0.18362.1) that
the build project adds to its archive. At the commits above, mpv
(`video/out/d3d11/ra_d3d11.c`) and libplacebo (`src/d3d11/gpu.c`) load an HLSL
compiler only for their Direct3D 11 renderers, in this order:
`d3dcompiler_47.dll` from the Windows system folder (on Windows 8.1 and later;
mpv.exe's manifest declares support for them), `d3dcompiler_47.dll` by the
normal search, `d3dcompiler_46.dll`, and only then `d3dcompiler_43.dll`.
`d3dcompiler_47.dll` is part of Windows since 8.1, and Abi Player runs only on
Windows 10 and later (Electron 45's minimum), so the bundled copy would only be
reached on a system that lacks the Windows compiler.

---

## 2. FFmpeg (ffmpeg, ffprobe)

| | |
|:--|:--|
| Shipped as | `resources\ffmpeg\`: `ffmpeg.exe`, `ffprobe.exe`, `avcodec-63.dll`, `avdevice-63.dll`, `avfilter-12.dll`, `avformat-63.dll`, `avutil-61.dll`, `swresample-7.dll`, `swscale-10.dll` and `LICENSE.txt`, unchanged from the archive below (its headers, import libraries, documentation and presets are not shipped), plus Abi Player's own `.ffmpeg-source.json` record of the pin |
| Version | `ffmpeg version n9.0.2-39-g7adfbe40dc-20261031` (from `ffmpeg -version`; `ffprobe -version` reports the same) |
| Upstream source | <https://git.ffmpeg.org/ffmpeg.git> (mirror <https://github.com/FFmpeg/FFmpeg>), commit [`7adfbe40dcde598f93a6963d2f7b22cd75202ccc`](https://github.com/FFmpeg/FFmpeg/tree/7adfbe40dcde598f93a6963d2f7b22cd75202ccc) (39 commits after tag `n9.0.2`, on `release/9.0`) |
| Binary build | [FFmpeg-Builds/FFmpeg-Builds](https://github.com/FFmpeg-Builds/FFmpeg-Builds) (formerly `BtbN/FFmpeg-Builds`, which the release notes still link to), release [`autobuild-2026-10-31-12-59`](https://github.com/FFmpeg-Builds/FFmpeg-Builds/releases/tag/autobuild-2026-10-31-12-59), asset `ffmpeg-n9.0.2-39-g7adfbe40dc-win64-gpl-shared-9.0.zip` (85920857 bytes, SHA-256 `1d9823c35c7a7e2f54d1438cf61030d6efabe3278de01c191309d1e828bb74df`) |
| Build scripts | tag `autobuild-2026-10-31-12-59` = commit [`5031c6f1082414e53688d39e521849905071070d`](https://github.com/FFmpeg-Builds/FFmpeg-Builds/tree/5031c6f1082414e53688d39e521849905071070d); target `win64`, variant `gpl-shared`, addin `9.0`. Every external library is pinned to a commit in the matching file under `scripts.d/` of that commit |
| Source archives on the release page | `source-ffmpeg-n9.0.2-39-g7adfbe40dc.tar.gz` (FFmpeg/FFmpeg), `source-ffmpeg-build-scripts-2026-10-31.tar.gz` (FFmpeg-Builds/FFmpeg-Builds): GitHub's archive of each commit named in this section |
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

**TMDB logo.** Section 3 of the same terms requires the TMDB logo to identify
the use of TMDB, less prominent than the application's own marks, and making
clear that it implies no endorsement. Ayarlar → Destek → Lisanslar shows it
small, next to the notice above. The file is TMDB's "alt short" blue logo from
<https://www.themoviedb.org/about/logos-attribution>, bundled unmodified as
`src/renderer/src/assets/tmdb/tmdb-alt-short-blue.svg` (2065 bytes, SHA-256
`8e7b30f73a4020692ccca9c88bafe5dcb6f8a62a4c6bc55cd9ba82bb2cd95f6c`, the hash
TMDB uses in the file's own name) and emitted as a separate file, never fetched
at run time. The logo and the TMDB name are TMDB's marks (terms, section 4);
they are not covered by Abi Player's MIT licence.
