#version 430 core

out vec4 outColor;

uniform vec4 uColor; // [추가] 외부에서 색상을 받음

void main() {
    outColor = vec4(1.0, 1.0, 0.0, 1.0); // 노란색 점

    //outColor = uColor; // 유니폼 색상 출력
}