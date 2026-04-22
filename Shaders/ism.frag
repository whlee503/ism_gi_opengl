#version 430 core
in float vDepth;
out vec4 outColor;

void main() {
    // 깊이 값(거리)을 기록
    // 시각적 확인을 위해 100으로 나눠서 출력해볼 수도 있음
    outColor = vec4(vDepth, vDepth*vDepth, 0, 1);
}