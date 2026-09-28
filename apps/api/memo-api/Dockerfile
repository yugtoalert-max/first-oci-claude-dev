# memo-api Function のイメージ。先に npm run bundle で dist/func.cjs を作っておく(npm run build:function で両方を実行する)
# ベースは OCI Functions の公式 Node FDK のランタイムイメージ(Node.js 24)。
# アプリケーションのシェイプは GENERIC_ARM なので、linux/arm64 でビルドする
FROM fnproject/node:24
WORKDIR /function
COPY dist/func.cjs /function/func.cjs
ENTRYPOINT ["node", "func.cjs"]
