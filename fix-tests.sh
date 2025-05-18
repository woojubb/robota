#!/bin/bash

# 패키지 디렉토리 탐색
for package_dir in packages/*/; do
  # 패키지 이름 추출
  package_name=$(basename "$package_dir")
  
  echo "Processing $package_name package..."
  
  # package.json에 test 스크립트 확인/수정
  if [ -f "$package_dir/package.json" ]; then
    if grep -q '"test":' "$package_dir/package.json"; then
      # test 스크립트가 있는 경우 --passWithNoTests 옵션 추가
      sed -i '' 's/"test": "vitest run"/"test": "vitest run --passWithNoTests"/g' "$package_dir/package.json"
      echo "Updated test script in $package_name"
    else
      # test 스크립트가 없는 경우 새로 추가
      sed -i '' '/"scripts": {/a\
    "test": "vitest run --passWithNoTests",
' "$package_dir/package.json"
      echo "Added test script to $package_name"
    fi
  fi
  
  # vitest.config.ts 파일 확인 및 생성/수정
  if [ ! -f "$package_dir/vitest.config.ts" ]; then
    cat > "$package_dir/vitest.config.ts" << 'EOL'
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'src/**/*.{test,spec}.{ts,tsx}',
      'tests/**/*.{test,spec}.{ts,tsx}'
    ],
    environment: 'node',
    testTimeout: 10000,
  },
});
EOL
    echo "Created vitest.config.ts for $package_name"
  fi
  
done

# 마지막으로 website 디렉토리도 처리
if [ -f "website/package.json" ]; then
  echo "Processing website package..."
  if grep -q '"test":' "website/package.json"; then
    # test 스크립트가 있는 경우 --passWithNoTests 옵션 추가
    sed -i '' 's/"test": "vitest run"/"test": "vitest run --passWithNoTests"/g' "website/package.json"
    echo "Updated test script in website"
  else
    # test 스크립트가 없는 경우 새로 추가
    sed -i '' '/"scripts": {/a\
  "test": "vitest run --passWithNoTests",
' "website/package.json"
    echo "Added test script to website"
  fi
fi

echo "All packages processed!" 