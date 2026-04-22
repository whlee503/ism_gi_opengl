#version 430 core

layout(location=0) out vec4 outPos;    // World Position
layout(location=1) out vec4 outNorm;   // World Normal
layout(location=2) out vec4 outFlux;   // Flux (Reflected Light Color)

in vec3 vPos;
in vec3 vNorm;

// [수정 1] Vertex Shader에서 넘겨준 변수 받기
in vec2 vTexCoord;

uniform vec4 diffColor;

// [수정 2] 텍스처 샘플러 추가
uniform sampler2D diffTex;
uniform int diffTexEnabled;

void main() {
    outPos = vec4(vPos, 1.0);
    outNorm = vec4(normalize(vNorm), 1.0);
    
    vec4 albedo = diffColor;
    
    // [수정 3] 텍스처가 있다면 읽어와서 덮어쓰기
    if(diffTexEnabled > 0) {
        albedo = texture(diffTex, vTexCoord);
      }

    // [핵심] 금속성(Physics) 무시하고 무조건 색상(Albedo) 저장!
    // 이렇게 해야 금속 물체도 주변 벽에 자기 색깔을 반사합니다.
    outFlux = albedo;

}