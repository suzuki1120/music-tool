# SYNTH SEQUENCER — TR-808 / TB-303 Groovebox

ブラウザだけで動くグルーヴボックスです。TR-808 風ドラムマシンと TB-303 風ベースシンセ、
エフェクト群、そして「それらしい曲」を自動生成するコンポーザーを 1 画面にまとめています。
ビルド不要・依存ライブラリなし（Web Audio API のみ）。

![Transport and TR-808](docs/screenshot-transport.jpg)

## 特徴

- **TR-808 リズムコンポーザー**: 10 音色（BD / SD / CP / CH / OH / LT / HT / CY / RS / CB）をシンセ合成。アクセント、オープン／クローズハットのチョーク、各音色のレベルノブ付き
- **TB-303 ベースライン**: 常駐型モノシンセ。CUTOFF / RESONANCE / ENV MOD / DECAY / ACCENT / LEVEL、SAW / SQR 切替。SLIDE は次ステップへ滑らかにつながる本物同様のレガート動作
- **コンポーザー**: STYLE（TECHNO / HOUSE / ACID / ELECTRO / MINIMAL / BREAKS）× KEY × SCALE を選んで **COMPOSE TRACK** を押すと、A1 → A2 → B1 → B2 の 4 パターンを同じキーで一括生成し、チェイン再生します
- **CHAOS FX**: Bit Crusher / Delay（MONO・PING PONG・REVERSE）/ Reverb + Freeze / Phaser / Ring Mod / Wave Folder / Auto Pan / Stutter / Tape Stop / Vinyl Brake / Euclidean / Mutate / Probability / Poly Rhythm / Drunk など
- **実機風 UI**: アンバー LCD、ロータリーノブ、808 系統色のステップボタン。設定とパターンは `localStorage` に自動保存

![TB-303](docs/screenshot-303.jpg)
![Chaos FX](docs/screenshot-fx.jpg)

## 動かし方

静的ファイルのみなので、任意の HTTP サーバーで `index.html` を開きます。

```bash
python3 -m http.server 8765
# → http://localhost:8765/index.html
```

MAMP などの `htdocs` 配下に置いても動作します。`file://` で直接開いた場合も再生はできますが、
フォント読み込みなど一部の挙動が変わるため HTTP 経由を推奨します。

対応ブラウザ: Chrome / Edge / Safari / Firefox の最新版（Web Audio API が必要）。
音を出すには最初にどこかをクリックするか PLAY を押してください（ブラウザの自動再生制限のため）。

## 操作

| 操作 | 内容 |
| --- | --- |
| `SPACE` | PLAY / STOP |
| `1` / `2` | INSTRUMENTS / CHAOS FX 切替 |
| `←` / `→` | パターン A1 → A2 → B1 → B2 を切替 |
| ノブをドラッグ | 値変更（`SHIFT` で微調整、ホイールと矢印キーも可、ダブルクリックで初期値） |
| 808 パッド クリック | ON / OFF（ドラッグで連続入力） |
| 808 パッド 右クリック / `SHIFT`+クリック | ACCENT |
| 303 NOTE クリック | 空き → 入力、入力済み → 選択（鍵盤・OCTAVE で変更）、選択中 → 削除 |
| 303 NOTE 右クリック | ACCENT 切替 |
| 303 NOTE 上でホイール | 半音単位で移調 |
| `−1` `+1` `−OCT` `+OCT` | パターン全体を移調 |
| COPY / PASTE | パターンの複製（808 / 303 それぞれ） |
| STUTTER（押している間） | 現在のステップをリピート。離すと拍位置に復帰 |
| TAPE STOP | 減速・ピッチダウンして停止 |
| VINYL BRAKE | 一瞬ブレーキをかけて復帰 |
| RESET（フッター） | 保存データを消去して初期化 |

## 自動生成の考え方

「ランダム＝破綻」にならないよう、生成は常に音楽的な制約の中で行います。

- **ビート**: スタイルごとにキックとバックビートの骨格を固定し、ハット／パーカッションは確率と上限付きで追加。小節内の総打数も上限あり
- **ベースライン**: 8 ステップのモチーフを生成し、後半は変化を加えて反復。ルート音を中心に 5 度・7 度・3 度へ寄せた重み付け。スライドは隣接する音同士のみ、アクセント・スライドの数に上限
- **4 パターン構成**: A1 = 基本、A2 = ハットなどの小変化、B1 = キック追加・パーカッション追加で盛り上げ、B2 = 最後の 4 ステップをフィル（スネアロール／タム／ドロップアウトなど）
- **音色・テンポ**: スタイルに合った範囲から BPM、スイング、303 のパラメータ、ディレイ設定を選択

`generator.js` の `MusicGen.compose()` がこの一連の処理を担当します。

## ファイル構成

| ファイル | 役割 |
| --- | --- |
| `index.html` / `style.css` | 画面構成と実機風スキン |
| `app.js` | UI の結線、描画ループ、`localStorage` への保存・復元 |
| `audio-engine.js` | AudioContext とマスターチェーン（入力 → FX → マスター → コンプ → リミッター） |
| `tr808.js` | ドラム音源（ヒットごとにノードを生成） |
| `tb303.js` | ベースシンセ（常駐オシレーター／フィルター／VCA） |
| `sequencer.js` | 先読みスケジューラ、スイング、チェイン再生、スタッター、テンポモデル |
| `chaos-fx.js` | 直列インサートチェーン（Dry/Wet）、ディレイ・リバーブのセンド、演奏系エフェクト、パターン加工 |
| `generator.js` | 楽曲生成（スタイル定義、スケール、モチーフ生成、4 パターン作曲） |
| `knobs.js` | `<input type="range" data-knob>` をロータリーノブに置き換える UI 部品 |

## 開発メモ

- 生成ロジックの検証は Node で `generator.js` を読み込み、`MusicGen.compose()` を多数回呼んで不変条件（スケール内、オクターブ範囲、スライド先が休符でない等）を確認する方法が手軽です
- `localStorage` のキーは `synthseq.v3`。保存形式を変えるときはバージョンを上げると旧データを安全に破棄できます
- Bit Crusher とリバースディレイは `ScriptProcessorNode` を使っています（非推奨 API ですが主要ブラウザで動作）。将来的には AudioWorklet への移行が候補です
