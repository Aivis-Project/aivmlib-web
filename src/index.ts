import { Base64 } from 'js-base64';
import * as $protobuf from 'protobufjs';
import * as uuid from 'uuid';

import { onnx } from '@/onnx-protobuf/onnx';
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
     * @returns 生成された AIVM メタデータ
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

            // 話者情報とスタイル情報の存在チェック
            if (Object.keys(hyper_parameters.data.spk2id).length === 0) {
                throw new Error('ハイパーパラメータに話者情報が含まれていません。');
            }
            if (Object.keys(hyper_parameters.data.style2id).length === 0) {
                throw new Error('ハイパーパラメータにスタイル情報が含まれていません。');
            }

            // スタイル ID が AIVM マニフェストの制約（0 <= id <= 31）を満たしているかチェック
            for (const [style_name, style_id] of Object.entries(hyper_parameters.data.style2id)) {
                if (style_id < 0 || style_id > 31) {
                    throw new Error(`スタイル「${style_name}」の ID（${style_id}）が有効範囲外です。スタイル ID は 0 から 31 の範囲である必要があります。`);
                }
            }

            // 話者 ID が非負整数であることを確認
            for (const [speaker_name, speaker_id] of Object.entries(hyper_parameters.data.spk2id)) {
                if (speaker_id < 0 || !Number.isInteger(speaker_id)) {
                    throw new Error(`話者「${speaker_name}」の ID（${speaker_id}）が有効範囲外です。話者 ID は 0 以上の整数である必要があります。`);
                }
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
            manifest.speakers = Object.keys(hyper_parameters.data.spk2id).map((speaker_name, speaker_id) => {
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
                    local_id: speaker_id,
                    // style2id の内容を反映
                    styles: Object.keys(hyper_parameters.data.style2id).map((style_name, style_id) => {
                        // "Neutral" はより分かりやすい "ノーマル" に変換する
                        // ただし、既にスタイル名が "ノーマル" のスタイルがある場合は "Neutral" のままにする
                        const new_style_name = (style_name === 'Neutral' && !Object.keys(hyper_parameters.data.style2id).includes('ノーマル'))
                            ? 'ノーマル'
                            : style_name;
                        return {
                            name: new_style_name,
                            icon: null,
                            local_id: style_id,
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
     * 既存の AIVM メタデータを、新しいハイパーパラメータとスタイルベクトルで更新する (モデル差し替え用)
     * 既存の UUID やユーザー設定メタデータは可能な限り維持される
     * @param existing_metadata 既存の AIVM メタデータ
     * @param hyper_parameters_file 新しいハイパーパラメータファイル
     * @param style_vectors_file 新しいスタイルベクトルファイル
     * @returns 更新された AIVM メタデータと警告メッセージの配列
     */
    static async updateAivmMetadata(
        existing_metadata: AivmMetadata,
        hyper_parameters_file: File,
        style_vectors_file: File,
    ): Promise<{ updated_metadata: AivmMetadata, warnings: string[] }> {
        const warnings: string[] = [];

        // 既存の AIVM マニフェストからモデルアーキテクチャを取得
        const model_architecture = existing_metadata.manifest.model_architecture;

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

            // 新しい話者・スタイル情報を取得
            const new_spk2id = hyper_parameters.data.spk2id;
            const new_style2id = hyper_parameters.data.style2id;

            // 話者情報とスタイル情報の存在チェック
            if (Object.keys(hyper_parameters.data.spk2id).length === 0) {
                throw new Error('ハイパーパラメータに話者情報が含まれていません。');
            }
            if (Object.keys(hyper_parameters.data.style2id).length === 0) {
                throw new Error('ハイパーパラメータにスタイル情報が含まれていません。');
            }

            // スタイル ID が AIVM マニフェストの制約（0 <= id <= 31）を満たしているかチェック
            for (const [style_name, style_id] of Object.entries(hyper_parameters.data.style2id)) {
                if (style_id < 0 || style_id > 31) {
                    throw new Error(`スタイル「${style_name}」の ID（${style_id}）が有効範囲外です。スタイル ID は 0 から 31 の範囲である必要があります。`);
                }
            }

            // 話者 ID が非負整数であることを確認
            for (const [speaker_name, speaker_id] of Object.entries(hyper_parameters.data.spk2id)) {
                if (speaker_id < 0 || !Number.isInteger(speaker_id)) {
                    throw new Error(`話者「${speaker_name}」の ID（${speaker_id}）が有効範囲外です。話者 ID は 0 以上の整数である必要があります。`);
                }
            }

            // 指定された既存の AIVM マニフェストをコピーした後、
            // ハイパーパラメータの記述に応じてモデルアーキテクチャを更新
            // NOTE: 音声合成モデル名は意図的に既存の AIVM マニフェストに記載の内容を維持している
            const manifest = structuredClone(existing_metadata.manifest);
            manifest.model_architecture = hyper_parameters.data.use_jp_extra ? 'Style-Bert-VITS2 (JP-Extra)' : 'Style-Bert-VITS2';

            // Map: local_id -> speaker_name
            const new_spk_id_to_name_map = new Map<number, string>();
            for (const [name, id] of Object.entries(new_spk2id)) {
                new_spk_id_to_name_map.set(id, name);
            }
            const processed_new_speaker_ids = new Set<number>(); // 処理済みの新しい local_id を追跡
            const updated_speakers: AivmManifest['speakers'] = [];

            // 既存の話者リストを基準にイテレート
            for (const existing_speaker of existing_metadata.manifest.speakers) {
                const speaker_local_id = existing_speaker.local_id;

                // 既存話者の local_id が新しい spk2id に存在するか確認
                if (new_spk_id_to_name_map.has(speaker_local_id)) {
                    // --- 話者が local_id ベースで新しいハイパーパラメータにも存在する場合 ---
                    const new_speaker_name = new_spk_id_to_name_map.get(speaker_local_id)!;
                    processed_new_speaker_ids.add(speaker_local_id);

                    const updated_styles: AivmManifest['speakers'][number]['styles'] = [];
                    const processed_new_style_raw_names = new Set<string>(); // スタイル順序維持用

                    // 既存のスタイルリストを基準にイテレート
                    for (const existing_style of existing_speaker.styles) {
                        const existing_style_name = existing_style.name;

                        // ノーマル/Neutral 互換性を考慮して新しいハイパーパラメータでの raw name を探す
                        let style_name_raw_in_new: string | null = null;
                        if (existing_style_name in new_style2id) {
                            style_name_raw_in_new = existing_style_name;
                        } else if (existing_style_name === 'ノーマル' && 'Neutral' in new_style2id) {
                            // 既存が「ノーマル」で新ハイパーパラメータに「Neutral」があるか？
                            // （かつ新ハイパーパラメータに「ノーマル」がない前提）
                            if (!('ノーマル' in new_style2id)) {
                                style_name_raw_in_new = 'Neutral';
                            }
                        } else if (existing_style_name === 'Neutral' && 'ノーマル' in new_style2id) {
                            // 既存が「Neutral」で新ハイパーパラメータに「ノーマル」があるか？
                            // （かつ新ハイパーパラメータに「Neutral」がない前提）
                            if (!('Neutral' in new_style2id)) { // これは常に true のはずだが念のため
                                style_name_raw_in_new = 'ノーマル';
                            }
                        }

                        if (style_name_raw_in_new !== null && style_name_raw_in_new in new_style2id) { // 再度存在確認
                            // スタイルが新しいハイパーパラメータにも存在する場合
                            processed_new_style_raw_names.add(style_name_raw_in_new);
                            const new_style_local_id = new_style2id[style_name_raw_in_new];
                            // 既存のスタイル名を維持し、ID のみ更新
                            updated_styles.push({
                                ...existing_style, // icon, voice_samples を維持
                                name: existing_style_name, // 既存の名前を使う
                                local_id: new_style_local_id,
                            });
                        } else {
                            // スタイルが削除された場合
                            warnings.push(`話者「${existing_speaker.name}」のスタイル「${existing_style_name}」は、新しいハイパーパラメータに存在しないため削除されます。`);
                        }
                    }

                    // 新しいハイパーパラメータで追加されたスタイルを追加
                    for (const [style_name, new_style_local_id] of Object.entries(new_style2id)) {
                        if (!processed_new_style_raw_names.has(style_name)) {
                            // "Neutral" -> "ノーマル" へ変換
                            const new_style_name = (style_name === 'Neutral' && !Object.keys(new_style2id).includes('ノーマル'))
                                ? 'ノーマル'
                                : style_name;

                            // 新しいハイパーパラメータで追加されたスタイル
                            updated_styles.push({
                                name: new_style_name,
                                icon: null,
                                local_id: new_style_local_id,
                                voice_samples: [],
                            });
                            warnings.push(`話者「${existing_speaker.name}」にスタイル「${new_style_name}」が新しく追加されました。`);
                        }
                    }

                    // モデルアーキテクチャが変更された場合に備え、supported_languages を計算し直す
                    // JP-Extra の場合は日本語のみ、それ以外は日本語・アメリカ英語・標準中国語をサポート
                    let supported_languages = existing_speaker.supported_languages;
                    const new_supported_languages = hyper_parameters.data.use_jp_extra ? ['ja'] : ['ja', 'en-US', 'zh-CN'];
                    if (JSON.stringify(supported_languages) !== JSON.stringify(new_supported_languages)) {
                        supported_languages = new_supported_languages;
                        warnings.push(`話者「${existing_speaker.name}」の対応言語が変更されました: ${supported_languages.join(', ')}`);
                    }

                    // 更新された話者情報を追加
                    updated_speakers.push({
                        ...existing_speaker, // uuid, icon などを維持
                        name: existing_speaker.name, // 既存の話者名を維持
                        local_id: speaker_local_id, // local_id は維持
                        styles: updated_styles, // 更新されたスタイルリスト
                        supported_languages: supported_languages, // 必要に応じて更新された対応言語
                    });

                } else {
                    // 話者が削除された場合
                    warnings.push(`話者「${existing_speaker.name}」 (ID: ${existing_speaker.local_id}) は、新しいハイパーパラメータに存在しないため削除されます。`);
                }
            }

            // 新しいハイパーパラメータで追加された話者を追加
            for (const [new_speaker_name, new_local_id] of Object.entries(new_spk2id)) {
                if (!processed_new_speaker_ids.has(new_local_id)) {
                    // 新しいハイパーパラメータで追加された話者
                    const new_speaker_styles: AivmManifest['speakers'][number]['styles'] = [];

                    // 新しいハイパーパラメータの全スタイルを追加
                    for (const [style_name, style_local_id] of Object.entries(new_style2id)) {
                        // "Neutral" はより分かりやすい "ノーマル" に変換する
                        // ただし、既にスタイル名が "ノーマル" のスタイルがある場合は "Neutral" のままにする
                        const new_style_name = (style_name === 'Neutral' && !Object.keys(new_style2id).includes('ノーマル'))
                            ? 'ノーマル'
                            : style_name;
                        new_speaker_styles.push({
                            name: new_style_name,
                            icon: null,
                            local_id: style_local_id,
                            voice_samples: [],
                        });
                    }

                    updated_speakers.push({
                        // ハイパーパラメータに記載の話者名を使用
                        name: new_speaker_name,
                        // デフォルトアイコンを使用
                        icon: DEFAULT_ICON_DATA_URL,
                        // JP-Extra の場合は日本語のみ、それ以外は日本語・アメリカ英語・標準中国語をサポート
                        supported_languages: hyper_parameters.data.use_jp_extra ? ['ja'] : ['ja', 'en-US', 'zh-CN'],
                        // 話者 UUID はランダムに生成
                        uuid: uuid.v4(),
                        // ローカル ID は spk2id の ID の部分を使用
                        local_id: new_local_id,
                        // style2id の内容を反映
                        styles: new_speaker_styles,
                    });
                    warnings.push(`話者「${new_speaker_name}」(ID: ${new_local_id}) が新しく追加されました。`);
                }
            }

            // マニフェストに更新された話者リストを設定
            manifest.speakers = updated_speakers;

            return {
                updated_metadata: {
                    // AIVM マニフェストを更新（モデル名や UUID などのユーザー設定はなるべく維持）
                    manifest: manifest,
                    // 新しいハイパーパラメータを反映
                    hyper_parameters: hyper_parameters,
                    // 新しいスタイルベクトルを反映
                    style_vectors: style_vectors,
                },
                warnings: warnings,
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
     * AIVM メタデータを生の辞書形式にシリアライズする
     * @param aivm_metadata AIVM メタデータ
     * @returns シリアライズされた AIVM メタデータ (文字列から文字列へのマップ)
     */
    static serializeAivmMetadata(aivm_metadata: AivmMetadata): { [key: string]: string } {

        // AIVM メタデータをシリアライズ
        // Safetensors / ONNX のメタデータ領域はネストなしの string から string への map でなければならないため、
        // すべてのメタデータを文字列にシリアライズして格納する
        const raw_metadata: { [key: string]: string } = {};
        raw_metadata['aivm_manifest'] = JSON.stringify(aivm_metadata.manifest);
        raw_metadata['aivm_hyper_parameters'] = JSON.stringify(aivm_metadata.hyper_parameters);

        // スタイルベクトルが存在する場合は Base64 エンコードして追加
        if (aivm_metadata.style_vectors) {
            raw_metadata['aivm_style_vectors'] = Base64.fromUint8Array(aivm_metadata.style_vectors);
        }

        return raw_metadata;
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

        // AIVM メタデータをシリアライズした上で、書き込む前にバリデーションを行う
        const raw_metadata = Aivmlib.serializeAivmMetadata(aivm_metadata);
        Aivmlib.validateAivmMetadata(raw_metadata);

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
        for (const key in raw_metadata) {
            existing_metadata[key] = raw_metadata[key];
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

        // AIVM メタデータをシリアライズした上で、書き込む前にバリデーションを行う
        const raw_metadata = Aivmlib.serializeAivmMetadata(aivm_metadata);
        Aivmlib.validateAivmMetadata(raw_metadata);

        // メタデータを ONNX モデルに追加
        if (!model.metadataProps) {
            model.metadataProps = [];
        }
        for (const key in raw_metadata) {
            // 同一のキーが存在する場合は上書き
            const existing_prop = model.metadataProps.find(prop => prop.key === key);
            if (existing_prop) {
                existing_prop.value = raw_metadata[key];
            } else {
                model.metadataProps.push({ key: key, value: raw_metadata[key] });
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
