from pathlib import Path

root = Path('.')
def replace(path, old, new):
    p = root / path
    source = p.read_text()
    assert source.count(old) == 1, (path, source.count(old))
    p.write_text(source.replace(old, new))

base = 'backend/src/main/java/com/mcschool/flashcard/liveclasses/'
replace(base + 'OnlineClassService.java',
'''    public boolean checkMediaApi(AuthenticatedUser caller, UUID classId) {
        return diagnoseMediaApi(caller, classId).reachable();
''',
'''    public boolean checkMediaApi(AuthenticatedUser caller, UUID classId) {
        requireHostForMutation(caller, classId);
        return diagnoseMediaApi(caller, classId).reachable();
''')
replace(base + 'OnlineClassWebhookService.java',
'''                    } else {
                        // markLeft ignores an unmatched leave''',
'''                    } else if (!joined) {
                        // markLeft ignores an unmatched leave''')
replace(base + 'provider/livekit/LiveKitMediaProvider.java',
'''        List<LivekitModels.ParticipantInfo> participants;
        try {
            participants = execute(roomServiceClient.listParticipants(roomName));
        } catch (MediaProviderException e) {
            if ("LiveKit request failed with HTTP 404".equals(e.getMessage())) return List.of();
            throw e;
        }
        if (participants == null) {
            return List.of();
        }
        return participants.stream().map(LivekitModels.ParticipantInfo::getIdentity).toList();
    }
''',
'''        try {
            Response<List<LivekitModels.ParticipantInfo>> response =
                    roomServiceClient.listParticipants(roomName).execute();
            if (response.isSuccessful() && response.body() != null) {
                return response.body().stream().map(LivekitModels.ParticipantInfo::getIdentity).toList();
            }
            // A reverse-proxy 404 or a malformed response is not proof that
            // the room is empty. Only the provider's explicit Twirp code is.
            if (response.code() == 404 && isMissingRoom(response.errorBody())) return List.of();
            throw new MediaProviderException("LiveKit presence check failed with HTTP " + response.code());
        } catch (java.io.IOException e) {
            throw new MediaProviderException("LiveKit presence check failed", e);
        }
    }

    private static boolean isMissingRoom(okhttp3.ResponseBody body) {
        if (body == null) return false;
        try (body) {
            byte[] bytes = body.byteStream().readNBytes(4097);
            if (bytes.length > 4096) return false;
            com.fasterxml.jackson.databind.JsonNode error =
                    new com.fasterxml.jackson.databind.ObjectMapper().readTree(bytes);
            return error != null && "not_found".equals(error.path("code").asText());
        } catch (java.io.IOException ignored) {
            return false;
        }
    }
''')

p = root / 'backend/src/test/java/com/mcschool/flashcard/liveclasses/provider/livekit/LiveKitMediaProviderTest.java'
s = p.read_text()
idx = s.rfind('\n}')
assert idx > 0
s = s[:idx] + '''

    @Test
    @SuppressWarnings("unchecked")
    void presenceAcceptsOnlyConfirmedEmptyOrExplicitMissingRoom() throws Exception {
        RoomServiceClient client = mock(RoomServiceClient.class);
        Call<java.util.List<LivekitModels.ParticipantInfo>> operation = mock(Call.class);
        when(client.listParticipants(ROOM)).thenReturn(operation);
        OnlineClassProperties properties = new OnlineClassProperties(
                true, "wss://example.livekit.cloud", API_KEY, API_SECRET,
                false, false, null, null, Duration.ofMinutes(10), null, null, false);
        LiveKitMediaProvider adapter = new LiveKitMediaProvider(properties, client);
        when(operation.execute()).thenReturn(retrofit2.Response.success(java.util.List.of()));
        assertThat(adapter.listParticipantIdentities(ROOM)).isEmpty();
        when(operation.execute()).thenReturn(retrofit2.Response.error(404,
                okhttp3.ResponseBody.create("{\\"code\\":\\"not_found\\"}", okhttp3.MediaType.get("application/json"))));
        assertThat(adapter.listParticipantIdentities(ROOM)).isEmpty();
        when(operation.execute()).thenReturn(retrofit2.Response.success(java.util.List.of(
                LivekitModels.ParticipantInfo.newBuilder().setIdentity("student|tablet").build())));
        assertThat(adapter.listParticipantIdentities(ROOM)).containsExactly("student|tablet");
    }

    @Test
    @SuppressWarnings("unchecked")
    void presenceNeverTreatsEndpointFailureOrNullResponseAsEmpty() throws Exception {
        RoomServiceClient client = mock(RoomServiceClient.class);
        Call<java.util.List<LivekitModels.ParticipantInfo>> operation = mock(Call.class);
        when(client.listParticipants(ROOM)).thenReturn(operation);
        OnlineClassProperties properties = new OnlineClassProperties(
                true, "wss://example.livekit.cloud", API_KEY, API_SECRET,
                false, false, null, null, Duration.ofMinutes(10), null, null, false);
        LiveKitMediaProvider adapter = new LiveKitMediaProvider(properties, client);
        for (String body : java.util.List.of("<html>not found</html>", "{}", "null",
                "{\\"code\\":\\"unavailable\\"}", "x".repeat(4097))) {
            when(operation.execute()).thenReturn(retrofit2.Response.error(404,
                    okhttp3.ResponseBody.create(body, okhttp3.MediaType.get("application/json"))));
            assertThatThrownBy(() -> adapter.listParticipantIdentities(ROOM)).isInstanceOf(MediaProviderException.class);
        }
        when(operation.execute()).thenReturn(retrofit2.Response.success(null));
        assertThatThrownBy(() -> adapter.listParticipantIdentities(ROOM)).isInstanceOf(MediaProviderException.class);
        when(operation.execute()).thenThrow(new IOException("offline"));
        assertThatThrownBy(() -> adapter.listParticipantIdentities(ROOM)).isInstanceOf(MediaProviderException.class);
    }
''' + s[idx:]
p.write_text(s)
