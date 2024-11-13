
import { Base64 } from 'js-base64';
import * as $protobuf from 'protobufjs';
import * as uuid from 'uuid';

import { onnx } from '@/onnx-protobuf/onnx.cjs';
import { AivmMetadata, AivmManifest, AivmManifestSchema, DefaultAivmManifest } from '@/schemas/aivm-manifest';
import { DEFAULT_ICON_DATA_URL } from '@/schemas/aivm-manifest-constants';
import { StyleBertVITS2HyperParameters, StyleBertVITS2HyperParametersSchema } from '@/schemas/style-bert-vits2';

// 各スキーマをすべてエクスポート
export * from '@/schemas/aivm-manifest';
export * from '@/schemas/style-bert-vits2';
export * from '@/schemas/aivm-manifest-constants';


/**
 * Aivis Voice Model File (.aivm/.aivmx) Utility Library
 *
 * AIVM / AIVMX ファイルフォーマットの仕様は下記ドキュメントを参照のこと
 * ref: https://github.com/Aivis-Project/aivmlib#aivm-specification
 */
export default class Aivmlib {

    /**
     * ハイパーパラメータファイルとスタイルベクトルファイルから AIVM メタデータを生成する
     * @param model_architecture 音声合成モデルのアーキテクチャ
     * @param hyper_parameters_file ハイパーパラメータファイル
     * @param style_vectors_file スタイルベクトルファイル
     */
    static async generateAivmMetadata(
        model_architecture: AivmManifest['model_architecture'],
        hyper_parameters_file: File,
        style_vectors_file: File | null,
    ): Promise<AivmMetadata> {

        // Style-Bert-VITS2 系の音声合成モデルの場合
        if (['Style-Bert-VITS2', 'Style-Bert-VITS2 (JP-Extra)'].includes(model_architecture)) {

            // ハイパーパラメータファイル (JSON) を読み込んだ後、Zod でバリデーションする
            const hyper_parameters_content = await hyper_parameters_file.text();
            let hyper_parameters: StyleBertVITS2HyperParameters;
            try {
                hyper_parameters = StyleBertVITS2HyperParametersSchema.parse(JSON.parse(hyper_parameters_content));
            } catch (error) {
                console.error(error);
                throw new Error(`${model_architecture} のハイパーパラメータファイルの形式が正しくありません。`);
            }

            // スタイルベクトルファイルを読み込む
            // Style-Bert-VITS2 モデルアーキテクチャの AIVM ファイルではスタイルベクトルが必須
            if (style_vectors_file === null) {
                throw new Error('スタイルベクトルファイルが指定されていません。');
            }
            const style_vectors_array_buffer = await style_vectors_file.arrayBuffer();
            const style_vectors = new Uint8Array(style_vectors_array_buffer);

            // デフォルトの AIVM マニフェストをコピーした後、ハイパーパラメータに記載の値で一部を上書きする
            const manifest = structuredClone(DefaultAivmManifest);
            manifest.name = hyper_parameters.model_name;
            // モデルアーキテクチャは Style-Bert-VITS2 系であれば異なる値が指定されても動作するように、ハイパーパラメータの値を使用する
            manifest.model_architecture = hyper_parameters.data.use_jp_extra ? 'Style-Bert-VITS2 (JP-Extra)' : 'Style-Bert-VITS2';
            // モデル UUID はランダムに生成
            manifest.uuid = uuid.v4();

            // spk2id の内容を反映
            manifest.speakers = Object.keys(hyper_parameters.data.spk2id).map((speaker_name, speaker_index) => {
                return {
                    // ハイパーパラメータに記載の話者名を使用
                    name: speaker_name,
                    // デフォルトアイコンを使用
                    icon: DEFAULT_ICON_DATA_URL,
                    // JP-Extra の場合は日本語のみ、それ以外は日本語・アメリカ英語・標準中国語をサポート
                    supported_languages: hyper_parameters.data.use_jp_extra ? ['ja'] : ['ja', 'en-US', 'zh-CN'],
                    // 話者 UUID はランダムに生成
                    uuid: uuid.v4(),
                    // ローカル ID は spk2id の ID の部分を使用
                    local_id: speaker_index,
                    // style2id の内容を反映
                    styles: Object.keys(hyper_parameters.data.style2id).map((style_name, style_index) => {
                        return {
                            // "Neutral" はより分かりやすい "ノーマル" に変換する
                            // ただし、既にスタイル名が "ノーマル" のスタイルがある場合は "Neutral" のままにする
                            name: (style_name === 'Neutral' && !Object.keys(hyper_parameters.data.style2id).includes('ノーマル')) ? 'ノーマル' : style_name,
                            icon: null,
                            local_id: style_index,
                            voice_samples: [],
                        };
                    }),
                };
            });

            return {
                manifest: manifest,
                hyper_parameters: hyper_parameters,
                style_vectors: style_vectors,
            };
        }

        throw new Error(`音声合成モデルアーキテクチャ ${model_architecture} には対応していません。`);
    }


    /**
     * AIVM メタデータをバリデーションする
     * @param raw_metadata 辞書形式の生のメタデータ
     * @returns バリデーションが完了した AIVM メタデータ
     */
    static validateAivmMetadata(raw_metadata: { [key: string]: string }): AivmMetadata {

        // AIVM マニフェストが存在しない場合
        if (!raw_metadata || !raw_metadata['aivm_manifest']) {
            throw new Error('AIVM マニフェストが見つかりません。');
        }

        // AIVM マニフェストのバリデーション
        let aivm_manifest: AivmManifest;
        try {
            aivm_manifest = AivmManifestSchema.parse(JSON.parse(raw_metadata['aivm_manifest']));
        } catch (error) {
            console.error(error);
            throw new Error('AIVM マニフェストの形式が正しくありません。');
        }

        // ハイパーパラメータのバリデーション
        let aivm_hyper_parameters: StyleBertVITS2HyperParameters;
        if (raw_metadata['aivm_hyper_parameters']) {
            try {
                if (['Style-Bert-VITS2', 'Style-Bert-VITS2 (JP-Extra)'].includes(aivm_manifest.model_architecture)) {
                    aivm_hyper_parameters = StyleBertVITS2HyperParametersSchema.parse(JSON.parse(raw_metadata['aivm_hyper_parameters']));
                } else {
                    throw new Error(`モデルアーキテクチャ ${aivm_manifest.model_architecture} のハイパーパラメータには対応していません。`);
                }
            } catch (error) {
                console.error(error);
                throw new Error('ハイパーパラメータの形式が正しくありません。');
            }
        } else {
            throw new Error('ハイパーパラメータが見つかりません。');
        }

        // スタイルベクトルのデコード
        let aivm_style_vectors: Uint8Array | undefined;
        if (raw_metadata['aivm_style_vectors']) {
            try {
                const base64_string: string = raw_metadata['aivm_style_vectors'];
                aivm_style_vectors = Base64.toUint8Array(base64_string);
            } catch (error) {
                throw new Error('スタイルベクトルのデコードに失敗しました。');
            }
        }

        return {
            manifest: aivm_manifest,
            hyper_parameters: aivm_hyper_parameters,
            style_vectors: aivm_style_vectors,
        };
    }


    /**
     * AIVM ファイルから AIVM メタデータを読み込む
     * @param aivm_file AIVM ファイル
     * @returns AIVM メタデータ
     */
    static async readAivmMetadata(aivm_file: File): Promise<AivmMetadata> {

        // ファイルの内容を読み込む
        const array_buffer = await aivm_file.arrayBuffer();
        const data_view = new DataView(array_buffer);

        // 先頭 8 バイトからヘッダーサイズを取得
        const header_size = data_view.getBigUint64(0, true);

        // ヘッダー部分を抽出
        let header_bytes: Uint8Array;
        try {
            header_bytes = new Uint8Array(array_buffer, 8, Number(header_size));
        } catch (error) {
            console.error(error);
            throw new Error('AIVM ファイルの形式が正しくありません。AIVM ファイル以外のファイルが指定されている可能性があります。');
        }
        const header_text = new TextDecoder('utf-8').decode(header_bytes);
        const header_json = JSON.parse(header_text);

        // "__metadata__" キーから AIVM メタデータを取得
        const raw_metadata = header_json['__metadata__'];

        // バリデーションを行った上で、AivmMetadata オブジェクトを構築して返す
        return Aivmlib.validateAivmMetadata(raw_metadata);
    }


    /**
     * AIVMX ファイルから AIVM メタデータを読み込む
     * @param aivmx_file AIVMX ファイル
     * @returns AIVM メタデータ
     */
    static async readAivmxMetadata(aivmx_file: File): Promise<AivmMetadata> {

        // ファイルの内容を読み込む
        const array_buffer = await aivmx_file.arrayBuffer();

        // ONNX モデル (Protobuf) をロード
        let model: onnx.IModelProto;
        try {
            const reader = new $protobuf.Reader(new Uint8Array(array_buffer));
            model = onnx.ModelProto.decode(reader);
        } catch (error) {
            console.error(error);
            throw new Error('AIVMX ファイルの形式が正しくありません。AIVMX ファイル以外のファイルが指定されている可能性があります。');
        }

        // AIVM メタデータを取得
        const raw_metadata: { [key: string]: string } = {};
        if (model.metadataProps) {
            for (const prop of model.metadataProps) {
                if (prop.key && prop.value) {
                    raw_metadata[prop.key] = prop.value;
                }
            }
        }

        // バリデーションを行った上で、AivmMetadata オブジェクトを構築して返す
        return Aivmlib.validateAivmMetadata(raw_metadata);
    }


    /**
     * AIVM メタデータを AIVM ファイルに書き込む
     * @param aivm_file AIVM ファイル
     * @param aivm_metadata AIVM メタデータ
     * @returns 書き込みが完了した AIVM ファイル
     */
    static async writeAivmMetadata(aivm_file: File, aivm_metadata: AivmMetadata): Promise<File> {

        // モデル形式を Safetensors に設定
        // AIVM ファイルのモデル形式は Safetensors のため、AIVM マニフェストにも明示的に反映する
        aivm_metadata.manifest.model_format = 'Safetensors';

        // AIVM マニフェストの内容をハイパーパラメータにも反映する
        // 結果は AivmMetadata オブジェクトに直接 in-place で反映される
        Aivmlib.applyAivmManifestToHyperParameters(aivm_metadata);

        // AIVM メタデータをシリアライズ
        // Safetensors のメタデータ領域はネストなしの string から string への map でなければならないため、
        // すべてのメタデータを文字列にシリアライズして格納する
        const metadata: { [key: string]: string } = {};
        metadata['aivm_manifest'] = JSON.stringify(aivm_metadata.manifest);
        metadata['aivm_hyper_parameters'] = JSON.stringify(aivm_metadata.hyper_parameters);
        if (aivm_metadata.style_vectors) {
            // スタイルベクトルが存在する場合は Base64 エンコードして追加
            metadata['aivm_style_vectors'] = Base64.fromUint8Array(aivm_metadata.style_vectors);
        }

        // AIVM ファイルの内容を一度に読み取る
        const aivm_file_buffer = await aivm_file.arrayBuffer();
        const aivm_file_bytes = new Uint8Array(aivm_file_buffer);

        // 既存のヘッダー JSON を取得
        const existing_header_size = new DataView(aivm_file_buffer).getBigUint64(0, true);
        const existing_header_bytes = aivm_file_bytes.slice(8, 8 + Number(existing_header_size));
        const existing_header_text = new TextDecoder('utf-8').decode(existing_header_bytes);
        let existing_header: { [key: string]: any };
        try {
            existing_header = JSON.parse(existing_header_text);
        } catch (error) {
            console.error(error);
            throw new Error('AIVM ファイルの形式が正しくありません。AIVM ファイル以外のファイルが指定されている可能性があります。');
        }

        // 既存の __metadata__ を取得または新規作成
        const existing_metadata = existing_header['__metadata__'] || {};

        // 既存の __metadata__ に新しいメタデータを追加
        // 既に存在するキーは上書きされる
        for (const key in metadata) {
            existing_metadata[key] = metadata[key];
        }

        // 更新された __metadata__ を設定
        existing_header['__metadata__'] = existing_metadata;

        // ヘッダー JSON を UTF-8 にエンコード
        const new_header_text = JSON.stringify(existing_header);
        const new_header_bytes = new TextEncoder().encode(new_header_text);

        // ヘッダーサイズを 8 バイトの符号なし Little-Endian 64bit 整数に変換
        const new_header_size = BigInt(new_header_bytes.length);
        const new_header_size_bytes = new Uint8Array(8);
        new DataView(new_header_size_bytes.buffer).setBigUint64(0, new_header_size, true);

        // 新しい AIVM ファイルの内容を作成
        const aivm_file_content = new Uint8Array(8 + new_header_bytes.length + (aivm_file_bytes.length - 8 - Number(existing_header_size)));
        aivm_file_content.set(new_header_size_bytes, 0);
        aivm_file_content.set(new_header_bytes, 8);
        aivm_file_content.set(aivm_file_bytes.slice(8 + Number(existing_header_size)), 8 + new_header_bytes.length);

        // 新しい AIVM ファイルを作成
        const new_aivm_file = new File([aivm_file_content], aivm_file.name, { type: aivm_file.type });

        return new_aivm_file;
    }


    /**
     * AIVM メタデータを AIVMX ファイルに書き込む
     * @param aivmx_file AIVMX ファイル
     * @param aivm_metadata AIVM メタデータ
     * @returns 書き込みが完了した AIVMX ファイル
     */
    static async writeAivmxMetadata(aivmx_file: File, aivm_metadata: AivmMetadata): Promise<File> {

        // モデル形式を ONNX に設定
        // AIVMX ファイルのモデル形式は ONNX のため、AIVM マニフェストにも明示的に反映する
        aivm_metadata.manifest.model_format = 'ONNX';

        // AIVM マニフェストの内容をハイパーパラメータにも反映する
        // 結果は AivmMetadata オブジェクトに直接 in-place で反映される
        Aivmlib.applyAivmManifestToHyperParameters(aivm_metadata);

        // ファイルの内容を読み込む
        const array_buffer = await aivmx_file.arrayBuffer();

        // ONNX モデル (Protobuf) をロード
        let model: onnx.IModelProto;
        try {
            const reader = new $protobuf.Reader(new Uint8Array(array_buffer));
            model = onnx.ModelProto.decode(reader);
        } catch (error) {
            console.error(error);
            throw new Error('AIVMX ファイルの形式が正しくありません。AIVMX ファイル以外のファイルが指定されている可能性があります。');
        }

        // AIVM メタデータをシリアライズ
        // ONNX のメタデータ領域はネストなしの string から string への key-value でなければならないため、
        // すべてのメタデータを文字列にシリアライズして格納する
        const metadata: { [key: string]: string } = {};
        metadata['aivm_manifest'] = JSON.stringify(aivm_metadata.manifest);
        metadata['aivm_hyper_parameters'] = JSON.stringify(aivm_metadata.hyper_parameters);
        if (aivm_metadata.style_vectors) {
            // スタイルベクトルが存在する場合は Base64 エンコードして追加
            metadata['aivm_style_vectors'] = Base64.fromUint8Array(aivm_metadata.style_vectors);
        }

        // メタデータを ONNX モデルに追加
        if (!model.metadataProps) {
            model.metadataProps = [];
        }
        for (const key in metadata) {
            // 同一のキーが存在する場合は上書き
            const existing_prop = model.metadataProps.find(prop => prop.key === key);
            if (existing_prop) {
                existing_prop.value = metadata[key];
            } else {
                model.metadataProps.push({ key: key, value: metadata[key] });
            }
        }

        // 新しい AIVMX ファイルの内容をシリアライズ
        const writer = onnx.ModelProto.encode(model);
        const aivmx_file_content = writer.finish();

        // 新しい AIVMX ファイルを作成
        const new_aivmx_file = new File([aivmx_file_content], aivmx_file.name, { type: aivmx_file.type });

        return new_aivmx_file;
    }


    /**
     * AIVM マニフェストの内容をハイパーパラメータにも反映する
     * 結果は AivmMetadata オブジェクトに直接 in-place で反映される
     * @param aivm_metadata AIVM メタデータ
     */
    static applyAivmManifestToHyperParameters(aivm_metadata: AivmMetadata): void {

        // Style-Bert-VITS2 系の音声合成モデルの場合
        if (['Style-Bert-VITS2', 'Style-Bert-VITS2 (JP-Extra)'].includes(aivm_metadata.manifest.model_architecture)) {

            // スタイルベクトルが設定されていなければエラー
            if (aivm_metadata.style_vectors === undefined) {
                throw new Error('スタイルベクトルが設定されていません。');
            }

            // モデル名を反映
            aivm_metadata.hyper_parameters.model_name = aivm_metadata.manifest.name;

            // 環境依存のパスが含まれるため、training_files と validation_files は固定値に変更
            aivm_metadata.hyper_parameters.data.training_files = 'train.list';
            aivm_metadata.hyper_parameters.data.validation_files = 'val.list';

            // 話者名を反映
            const new_spk2id: { [key: string]: number } = {};
            for (const speaker of aivm_metadata.manifest.speakers) {
                const local_id = speaker.local_id;
                const old_key = Object.keys(aivm_metadata.hyper_parameters.data.spk2id).find(
                    key => aivm_metadata.hyper_parameters.data.spk2id[key] === local_id
                );
                if (old_key) {
                    new_spk2id[speaker.name] = local_id;
                }
            }
            aivm_metadata.hyper_parameters.data.spk2id = new_spk2id;

            // スタイル名を反映
            const new_style2id: { [key: string]: number } = {};
            for (const speaker of aivm_metadata.manifest.speakers) {
                for (const style of speaker.styles) {
                    const local_id = style.local_id;
                    const old_key = Object.keys(aivm_metadata.hyper_parameters.data.style2id).find(
                        key => aivm_metadata.hyper_parameters.data.style2id[key] === local_id
                    );
                    if (old_key) {
                        new_style2id[style.name] = local_id;
                    }
                }
            }
            aivm_metadata.hyper_parameters.data.style2id = new_style2id;
        }
    }
}
