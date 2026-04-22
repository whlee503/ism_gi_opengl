// Imperfect Shadow Map Project - GI Pipeline Excerpt Code
// main.cpp 발췌


// GI pipeline excerpt from the original academic renderer integration.
// This excerpt includes the parts I implemented for:
// 1) RSM generation
// 2) VPL generation via compute shader
// 3) Point-based ISM atlas rendering
// 4) Pull-Push hole filling
//
// Base renderer/framework code is intentionally omitted.


//IN RENDER FUNC()
 
	// =========================================================
	// [애니메이션 로직] - Searchlight Mode
	// =========================================================
if (isLightAnimating) {
	// 속도에 맞춰 각도 증가
	lightAngle += lightRotationSpeed * 0.01f;
}

// UI로 조절된 Cutoff 값 안전 장치
if (light.cutoff > light.outerCutoff) light.cutoff = light.outerCutoff - 0.1f;

// 조명 위치 고정 (천장 높은 곳)
//light.position = vec3(0.0f, 5.0f, 0.0f);

// 조명 방향 회전
light.direction.x = sin(lightAngle);
light.direction.z = cos(lightAngle);
light.direction.y = -0.81f; // 약간 아래쪽을 향해서 바닥을 비춤

light.direction = normalize(light.direction);


vec3 objectPosition = position; // 물체의 초기 위치
float objectMoveSpeed = 5.0f;

// Delta Time 계산 (기존 유지)
static double lastFrameTime = glfwGetTime();
double currentFrameTime = glfwGetTime();
float deltaTime = float(currentFrameTime - lastFrameTime);
lastFrameTime = currentFrameTime;


// ----------- RSM 렌더링 (G-Buffer 생성) --------------
rsm.begin();						// 바인딩, 뷰포트, Clear 자동 처리

rsmProg.use();



// 스포트라이트 각도 설정 (RSM의 FOV와 연관됨)
light.cutoff = 26.0f;       // 내부 100도
light.outerCutoff = 27.0f;  // 외부 110도 (Shadow Map FOV와 일치 추천)

//vec3 lightDir = normalize(targetPos - light.position); // Z축 (Forward)
vec3 lightDir = light.direction;


vec3 rightAxis;
if (abs(lightDir.y) > 0.9999) {
	// 광원이 거의 수직으로 내려다볼 때 -> World X축을 오른쪽으로 삼음
	rightAxis = vec3(1, 0, 0);
}
else {
	// 비스듬할 때 -> World Up(0,1,0)과 외적하여 수평축 생성
	rightAxis = normalize(cross(lightDir, vec3(0, 1, 0)));
}


// 위쪽(Up) 벡터 재계산
vec3 realUp = cross(rightAxis, lightDir);

// 행렬 생성
mat4 lightView = lookAt(light.position, light.position + light.direction, realUp);


// 투영 행렬의 FOV를 Spotlight outerCutoff의 2배로 맞춤
mat4 lightProj = perspective(radians(light.outerCutoff * 2.0f), 1.0f, 0.1f, 100.f);


rsmProg.setUniform("viewMat", lightView);
rsmProg.setUniform("projMat", lightProj);



for (auto& mesh : meshSet) {

	mat4 finalModelMat = dynamicModelMat * mesh.modelMat;
	rsmProg.setUniform("modelMat", finalModelMat);


	// 텍스처 바인딩
	int textureID = mesh.material.diffTexID;
	if (textureID >= 0) {
		Texture& tex = texLib[textureID];
		// 0번 슬롯에 텍스처 바인딩
		tex.bind(9, rsmProg, "diffTex");
	}

	rsmProg.setUniform("diffTexEnabled", textureID >= 0 ? 1 : 0);


	rsmProg.setUniform("diffColor", mesh.material.diffColor);
	mesh.render(rsmProg);
}

rsm.end();						


vplGenProg.use();

// RSM 텍스처 바인딩
glActiveTexture(GL_TEXTURE0); glBindTexture(GL_TEXTURE_2D, rsm.posTex); // rsm.texID[0] 등 확인 필요
vplGenProg.setUniform("rsmPosTex", 0);

glActiveTexture(GL_TEXTURE1); glBindTexture(GL_TEXTURE_2D, rsm.normTex);
vplGenProg.setUniform("rsmNormTex", 1);

glActiveTexture(GL_TEXTURE2); glBindTexture(GL_TEXTURE_2D, rsm.fluxTex);
vplGenProg.setUniform("rsmFluxTex", 2);

// Uniform 전달
vplGenProg.setUniform("uTime", (float)glfwGetTime());

vplGenProg.setUniform("uLightPos", light.position);
vplGenProg.setUniform("uLightFactor", lightFactor);
vplGenProg.setUniform("uGridCols", ISM_GRID_SIZE);

// SSBO 바인딩 (Binding Point 0)
glBindBufferBase(GL_SHADER_STORAGE_BUFFER, 0, vplSSBO);

// Compute Shader 실행
glDispatchCompute(N_VPL / 256, 1, 1);

// 메모리 배리어: VPL 생성이 다 끝날 때까지 다음 단계(ISM 렌더링) 대기
glMemoryBarrier(GL_SHADER_STORAGE_BARRIER_BIT | GL_VERTEX_ATTRIB_ARRAY_BARRIER_BIT);




// ----------- ISM Atlas 렌더링 (Instanced Point Cloud) -----------

ismAtlas.use();

glViewport(0, 0, ISM_ATLAS_SIZE, ISM_ATLAS_SIZE);

ismAtlas.fill(vec4(1000.0)); // 먼 거리로 초기화 (검은색 대신)

ismProg.use();


ismProg.setUniform("modelMat", dynamicModelMat);


// SSBO 바인딩 (VPL 정보 + 포인트 정보)
// ism.vert가 VPL 위치를 읽어야 하므로 0번(VPL)과 1번(Point) 모두 바인딩
glBindBufferBase(GL_SHADER_STORAGE_BUFFER, 0, vplSSBO);           // Binding 0: VPLs
glBindBufferBase(GL_SHADER_STORAGE_BUFFER, 1, scenePointsLow.ssbo); // Binding 1: Global Points

// Uniform 설정
ismProg.setUniform("totalPoints", scenePointsLow.totalPointCount);
ismProg.setUniform("gridCols", ISM_GRID_SIZE);
ismProg.setUniform("gridRows", ISM_GRID_SIZE);

ismProg.setUniform("isDirectPass", 0);


int pointsPerVPL = 8000; // 2048 ~ 8192 사이 조절 (성능/품질 타협점)

// VAO 바인딩 (Core Profile 필수)
glBindVertexArray(scenePointsLow.vao);

// [1] 점 크기 조절 활성화 (반드시 Draw 호출 전에!)
glEnable(GL_PROGRAM_POINT_SIZE);


// [2] Min-Blending 활성화 (가장 가까운 깊이 값 저장)
glEnable(GL_BLEND);
glBlendEquation(GL_MIN);         // 겹치면 더 작은 값(가까운 거리) 선택
glBlendFunc(GL_ONE, GL_ONE);     // 소스와 타겟 값을 그대로 비교
glDisable(GL_DEPTH_TEST);        // Z-버퍼 대신 색상(Red채널) 블렌딩으로 깊이 판정


// Instanced Draw


glDrawArraysInstanced(GL_POINTS, 0, pointsPerVPL, N_VPL);


glBindBufferBase(GL_SHADER_STORAGE_BUFFER, 1, 0);



// ================= [설정 복구] =================

glDisable(GL_BLEND);
glBlendEquation(GL_FUNC_ADD); // 기본값 복구
glEnable(GL_DEPTH_TEST);      // 깊이 테스트 복구
// glDisable(GL_PROGRAM_POINT_SIZE); 


glBindVertexArray(0);

ismAtlas.unuse();




// ================== [Pull-Push Phase Start] ====================

if (usePullPush) {
	GLint prevViewport[4];
	glGetIntegerv(GL_VIEWPORT, prevViewport);

	glDisable(GL_DEPTH_TEST);

	// ----------------------------------------------------
	// 1. 초기 설정: 4단계까지 Mipmap 생성 준비
	// ----------------------------------------------------
	glActiveTexture(GL_TEXTURE0);
	glBindTexture(GL_TEXTURE_2D, ismAtlas.texID);
	glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST_MIPMAP_NEAREST);
	glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
	glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_BASE_LEVEL, 0);
	glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAX_LEVEL, 4); // Level 4까지 사용

	// ----------------------------------------------------
	// 2. PULL Phase 
	// ----------------------------------------------------
	pullProg.use();
	pullProg.setUniform("uTex", 0);

	for (int i = 0; i < 3; ++i) {
		int w = ISM_ATLAS_SIZE >> (i + 1); // 타겟 해상도 (반으로 줄임)

		// [중요] 읽기용 텍스처 바인딩 확인
		glActiveTexture(GL_TEXTURE0);
		glBindTexture(GL_TEXTURE_2D, ismAtlas.texID);

		// Step A: Temp에 다운샘플링 결과 쓰기
		glBindFramebuffer(GL_FRAMEBUFFER, ismTemp.fbID);
		glViewport(0, 0, w, w);

		// 쉐이더: i 레벨을 읽어서 그립니다
		pullProg.setUniform("uLevel", i);
		TriMesh::renderQuad(pullProg);

		// Step B: Temp 결과를 ismAtlas의 i+1 레벨로 복사
		// 복사 전 텍스처 바인딩 해제 (피드백 방지)
		glBindTexture(GL_TEXTURE_2D, 0);

		glBindFramebuffer(GL_READ_FRAMEBUFFER, ismTemp.fbID);
		glBindFramebuffer(GL_DRAW_FRAMEBUFFER, ismAtlas.fbID);
		glFramebufferTexture2D(GL_DRAW_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, ismAtlas.texID, i + 1);

		glBlitFramebuffer(0, 0, w, w, 0, 0, w, w, GL_COLOR_BUFFER_BIT, GL_NEAREST);
	}

	// ----------------------------------------------------
	// 3. PUSH Phase
	// ----------------------------------------------------
	pushProg.use();

	pushProg.setUniform("uHighRes", 0); // ismAtlas (Slot 0)
	pushProg.setUniform("uLowRes", 0);  // ismAtlas (Slot 0)

	// 역순 루프: 가장 거친 레벨(L4)부터 시작해서 L0까지 메움
	for (int j = 2; j >= 0; --j) {
		int w = ISM_ATLAS_SIZE >> j; // 현재 타겟 레벨 해상도

		// 매 반복마다 텍스처를 확실하게 바인딩 (읽기 모드)
		glActiveTexture(GL_TEXTURE0);
		glBindTexture(GL_TEXTURE_2D, ismAtlas.texID);

		// 1. Temp에 쓰기 (계산)
		glBindFramebuffer(GL_FRAMEBUFFER, ismTemp.fbID);
		glViewport(0, 0, w, w);

		// 쉐이더: j 레벨(HighRes)과 j+1 레벨(LowRes)을 섞음
		pushProg.setUniform("uLevel", j);
		TriMesh::renderQuad(pushProg);

		// 2. Temp 결과를 원본(ismAtlas)의 j 레벨로 복사
		// 복사하기 전에 텍스처 바인딩을 해제
		glBindTexture(GL_TEXTURE_2D, 0);

		glBindFramebuffer(GL_READ_FRAMEBUFFER, ismTemp.fbID);
		glBindFramebuffer(GL_DRAW_FRAMEBUFFER, ismAtlas.fbID);
		glFramebufferTexture2D(GL_DRAW_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, ismAtlas.texID, j);

		// 안전하게 복사 수행
		glBlitFramebuffer(0, 0, w, w, 0, 0, w, w, GL_COLOR_BUFFER_BIT, GL_NEAREST);
	}

	// ----------------------------------------------------
	// 4. Cleanup (상태 복구)
	// ----------------------------------------------------

	glEnable(GL_DEPTH_TEST);

	glActiveTexture(GL_TEXTURE0);
	glBindTexture(GL_TEXTURE_2D, ismAtlas.texID);

	// 씬 렌더링 시 부드러운 보간을 위해 Linear 필터 복구
	glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR_MIPMAP_NEAREST);
	glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);

	// FBO 타겟을 Level 0으로 되돌려놔야 다음 프레임에 정상 작동
	glBindFramebuffer(GL_FRAMEBUFFER, ismAtlas.fbID);
	glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, ismAtlas.texID, 0);

	// FBO 복구 (기본 화면으로)
	glBindFramebuffer(GL_FRAMEBUFFER, 0);
	glViewport(prevViewport[0], prevViewport[1], prevViewport[2], prevViewport[3]);
}
else {
	// [OFF] - 깜빡임 방지용 예외
	glActiveTexture(GL_TEXTURE0);
	glBindTexture(GL_TEXTURE_2D, ismAtlas.texID);
	glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_BASE_LEVEL, 0);
	glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAX_LEVEL, 0);
	glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
	glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);

}

glViewport(0, 0, scrW, scrH);

// ================ [Pull-Push Phase End] ===================