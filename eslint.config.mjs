// ESLint düz yapılandırması (F0-02).
//
// Biçim kuralı yoktur; yalnızca hata yakalayan kurallar. Mevcut kodun bugün
// ihlal ettiği kurallar "warn" düzeyindedir: taban geçer, uyarılar görünür kalır.
// Bir dosyaya dokunan, o dosyadaki uyarıları da temizler; kural temizlendikçe
// "error" düzeyine çekilir.
import js from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: [
      'out/**',
      'dist/**',
      'node_modules/**',
      'resources/**',
      'build/**',
      '.react-doctor/**',
      // Generated test media (its .ts files are MPEG-TS segments) and reports.
      'e2e/.cache/**',
      'e2e/.output/**'
    ]
  },

  js.configs.recommended,
  tseslint.configs.recommended,

  // Tür bilgisi gerektiren kurallar: her dosya kendi tsconfig'i ile çözülür.
  {
    files: ['src/**/*.{ts,tsx}', 'scripts/**/*.{mjs,ts}', 'e2e/**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.web.json', './tsconfig.scripts.json', './e2e/tsconfig.json'],
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      // `_` ile başlayan adlar bilinçli olarak kullanılmıyor demektir.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_'
        }
      ]
    }
  },

  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser }
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error'
    }
  },

  {
    files: ['src/main/**/*.ts', 'src/preload/**/*.ts', 'scripts/**/*.{mjs,ts}', 'e2e/**/*.ts'],
    languageOptions: {
      globals: { ...globals.node }
    }
  },

  // Playwright reads a fixture's dependencies from its first parameter and
  // rejects anything but an object pattern, so a fixture without dependencies
  // has to be written `async ({}, use) => ...`.
  {
    files: ['e2e/**/*.ts'],
    rules: {
      'no-empty-pattern': ['error', { allowObjectPatternsAsParameters: true }]
    }
  },

  // Taban: yalnızca arayüz bileşenleri ve sayfalar bu kuralları hâlâ ihlal
  // ediyor; metin sözlüğü taşıması bitince bu iki blok silinir ve kurallar
  // yukarıdaki "error" düzeyine döner. Geri kalan her yerde her kural "error".
  {
    files: ['src/renderer/src/components/**/*.{ts,tsx}', 'src/renderer/src/pages/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-misused-promises': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_'
        }
      ],
      '@typescript-eslint/no-unused-expressions': 'warn',
      '@typescript-eslint/ban-ts-comment': 'warn',
      'no-empty': 'warn',
      'no-useless-assignment': 'warn',
      'preserve-caught-error': 'warn'
    }
  },
  {
    files: ['src/renderer/src/components/**/*.{ts,tsx}', 'src/renderer/src/pages/**/*.{ts,tsx}'],
    rules: {
      'react-hooks/exhaustive-deps': 'warn'
    }
  }
)
