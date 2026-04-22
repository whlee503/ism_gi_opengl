#version 430 core

layout(location=0) in vec3 inPosition;
layout(location=1) in vec3 inNormal;
layout(location=2) in vec2 inTexCoord;

uniform mat4 modelMat;
uniform mat4 viewMat;
uniform mat4 projMat;

out vec3 vPos;
out vec3 vNorm;
out vec4 vColor; // 텍스처 색상 등

// 텍스처 샘플링을 위해 필요하다면...
out vec2 vTexCoord;

void main() {
    vec4 worldPos = modelMat * vec4(inPosition, 1.0);
    vPos = worldPos.xyz;
    vNorm = normalize((modelMat * vec4(inNormal, 0.0)).xyz);

    vTexCoord = inTexCoord;

    gl_Position = projMat * viewMat * worldPos;
}