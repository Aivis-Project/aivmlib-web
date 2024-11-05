
# aivmlib-web

💠 **aivmlib-web**: **Ai**vis **V**oice **M**odel File (.aivm/.aivmx) Utility **Lib**rary for **Web**

-----

**AIVM** (**Ai**vis **V**oice **M**odel) / **AIVMX** (**Ai**vis **V**oice **M**odel for ONN**X**) は、**学習済みモデル・ハイパーパラメータ・スタイルベクトル・話者メタデータ（名前・概要・ライセンス・アイコン・ボイスサンプル など）を 1 つのファイルにギュッとまとめた、AI 音声合成モデル用オープンファイルフォーマット**です。

> [!NOTE]  
> **「AIVM」は、AIVM / AIVMX 両方のフォーマット仕様・メタデータ仕様の総称でもあります。**  
> 具体的には、AIVM ファイルは「AIVM メタデータを追加した Safetensors 形式」、AIVMX ファイルは「AIVM メタデータを追加した ONNX 形式」のモデルファイルです。  
> 「AIVM メタデータ」とは、AIVM 仕様に定義されている、学習済みモデルに紐づく各種メタデータのことをいいます。

[AivisSpeech](https://github.com/Aivis-Project/AivisSpeech) / [AivisSpeech-Engine](https://github.com/Aivis-Project/AivisSpeech-Engine) をはじめとした AIVM 仕様に対応するソフトウェアに AIVM / AIVMX ファイルを追加することで、AI 音声合成モデルを簡単に利用できます。

**[aivmlib](https://github.com/Aivis-Project/aivmlib) / aivmlib-web では、AIVM / AIVMX ファイル内のメタデータを読み書きするためのユーティリティを提供します。**  
この aivmlib-web は、Python で書かれた aivmlib をブラウザ上で利用できるよう TypeScript に移植したものです。Python 環境で利用する場合は aivmlib をご利用ください。

aivmlib / aivmlib-web で実装されている AIVM 仕様については [AIVM Specification](https://github.com/Aivis-Project/aivmlib#aivm-specification) をご覧ください。

> [!TIP]  
> **[AIVM Generator](https://aivm-generator.aivis-project.com/) では、ブラウザ上の GUI でかんたんに AIVM / AIVMX ファイルを生成・編集できます。**  
> 手動で AIVM / AIVMX ファイルを生成・編集する際は AIVM Generator の利用をおすすめします。

## Installation

Node.js 20 以上が必要です。

```bash
npm install aivmlib-web
```

> [!IMPORTANT]  
> このライブラリは Web ブラウザ向けに開発されているため、Node.js や Deno などサーバーサイド JavaScript 環境では利用できません。

## License

[MIT License](License.txt)
